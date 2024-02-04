// retell-client-sdk.ts
import {
    AudioWsClient,
    convertFloat32ToUint8,
    convertUint8ToFloat32,
} from "retell-sdk";

interface StartConversationConfig {
    callId: string;
    sampleRate?: number;
    customStream?: MediaStream | null;
}

type EventListener = (data?: any) => void;

export class RetellClientSdk {
    private liveClient: AudioWsClient | null = null;
    private audioContext: AudioContext | null = null;
    private isCalling: boolean = false;
    private stream: MediaStream | null = null;
    private captureNode: ScriptProcessorNode | null = null;
    private audioData: Float32Array[] = [];
    private audioDataIndex: number = 0;
    private eventListeners: Record<string, EventListener[]> = {
        onConversationStarted: [],
        onConversationEnded: [],
        onError: [],
    };

    constructor() {
    }

    public async startConversation({ callId, sampleRate = 22050, customStream = null }: StartConversationConfig): Promise<void> {
        try {
            await this.setupAudio(sampleRate, customStream);
            this.liveClient = new AudioWsClient(callId);
            this.handleAudioEvents();
            this.isCalling = true;
            this.audioContext!.resume();
            this.triggerEvent('onConversationStarted');
        } catch (err) {
            this.triggerEvent('onError', (err as Error).message);
        }
    }

    public stopConversation(): void {
        this.isCalling = false;
        this.liveClient?.close();
        this.audioContext?.suspend();
        // Disconnect and release the captureNode and audioContext resources
        if (this.captureNode) {
            this.captureNode.disconnect();
            this.captureNode.onaudioprocess = null; // Prevent memory leak by detaching the event handler
        }
        if (this.audioContext) {
            this.audioContext.close(); // Properly close the audio context to release system audio resources
        }
        this.stream?.getTracks().forEach((track) => track.stop());
        // Release references to allow for garbage collection
        this.liveClient = null;
        this.audioContext = null;
        this.stream = null;
        this.captureNode = null;
        this.audioData = [];
        this.audioDataIndex = 0;
        this.triggerEvent('onConversationEnded');
    }

    public on(event: string, listener: EventListener): void {
        if (this.eventListeners[event]) {
            this.eventListeners[event].push(listener);
        }
    }

    private async setupAudio(sampleRate: number, customStream: MediaStream | null = null): Promise<void> {
        this.audioContext = new AudioContext({ sampleRate: sampleRate });

        try {
            this.stream = customStream || await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: sampleRate,
                    echoCancellation: true,
                    noiseSuppression: true,
                    channelCount: 1,
                },
            });
        } catch (error) {
            throw new Error("User didn't give microphone permission");
        }

        const source = this.audioContext.createMediaStreamSource(this.stream);
        this.captureNode = this.audioContext.createScriptProcessor(2048, 1, 1);
        this.captureNode.onaudioprocess = (audioProcessingEvent: AudioProcessingEvent) => {

            if (this.isCalling) {
                const pcmFloat32Data =
                    audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmData = convertFloat32ToUint8(pcmFloat32Data);
                this.liveClient.send(pcmData);

                // Playback here
                const outputBuffer = audioProcessingEvent.outputBuffer;
                const outputChannel = outputBuffer.getChannelData(0);
                for (let i = 0; i < outputChannel.length; ++i) {
                    if (this.audioData.length > 0) {
                        outputChannel[i] = this.audioData[0][this.audioDataIndex++];
                        if (this.audioDataIndex === this.audioData[0].length) {
                            this.audioData.shift();
                            this.audioDataIndex = 0;
                        }
                    } else {
                        outputChannel[i] = 0;
                    }
                }
            }
        };
        source.connect(this.captureNode);
        this.captureNode.connect(this.audioContext.destination);
    }

    private handleAudioEvents(): void {
        this.liveClient!.on("audio", (audio: Uint8Array) => {
            const float32Data = convertUint8ToFloat32(audio);
            this.audioData.push(float32Data);
        });

        this.liveClient!.on("error", (error: string) => {
            this.triggerEvent('onError', error);
            this.stopConversation();
        });

        this.liveClient!.on("close", (code: number, reason: string) => {
            this.stopConversation();
            this.triggerEvent('onConversationEnded', { code, reason });
        });
    }

    private triggerEvent(eventName: string, data?: any): void {
        if (this.eventListeners[eventName]) {
            this.eventListeners[eventName].forEach(listener => listener(data));
        }
    }
}
