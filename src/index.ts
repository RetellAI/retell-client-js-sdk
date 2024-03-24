// retell-client-sdk.ts
import {
  AudioWsClient,
  convertFloat32ToUint8,
  convertUint8ToFloat32,
} from "./audioWsClient";
import { EventEmitter } from "eventemitter3";
import { workletCode } from "./audioWorklet";

export interface StartConversationConfig {
  callId: string;
  sampleRate: number;
  customStream?: MediaStream;
  enableUpdate?: boolean;
}

export class RetellWebClient extends EventEmitter {
  private liveClient: AudioWsClient;
  private audioContext: AudioContext;
  private isCalling: boolean = false;
  private stream: MediaStream;

  // Chrome
  private audioNode: AudioWorkletNode;
  private customEndpoint: string;

  // Others
  private captureNode: ScriptProcessorNode | null = null;
  private audioData: Float32Array[] = [];
  private audioDataIndex: number = 0;
  private isTalking: boolean = false;

  constructor(customEndpoint?: string) {
    super();

    if (customEndpoint) this.customEndpoint = customEndpoint;
  }

  public async startConversation(
    startConversationConfig: StartConversationConfig,
  ): Promise<void> {
    try {
      await this.setupAudioPlayback(
        startConversationConfig.sampleRate,
        startConversationConfig.customStream,
      );
      this.liveClient = new AudioWsClient({
        callId: startConversationConfig.callId,
        enableUpdate: startConversationConfig.enableUpdate,
        customEndpoint: this.customEndpoint,
      });
      this.handleAudioEvents();
      this.isCalling = true;
    } catch (err) {
      this.emit("error", (err as Error).message);
    }
  }

  public stopConversation(): void {
    this.isCalling = false;
    this.liveClient?.close();
    this.audioContext?.suspend();
    this.audioContext?.close(); // Properly close the audio context to release system audio resources

    if (this.isAudioWorkletSupported()) {
      this.audioNode?.disconnect();
      this.audioNode = null; // Prevent memory leak by detaching the event handler
    } else {
      if (this.captureNode) {
        this.captureNode.disconnect();
        this.captureNode.onaudioprocess = null; // Prevent memory leak by detaching the event handler
        this.captureNode = null;
        this.audioData = [];
        this.audioDataIndex = 0;
      }
    }
    // Release references to allow for garbage collection
    this.liveClient = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioContext = null;
    this.stream = null;
  }

  private handleAudioEvents(): void {
    // Exposed
    this.liveClient.on("open", () => {
      this.emit("conversationStarted");
    });

    this.liveClient.on("audio", (audio: Uint8Array) => {
      this.playAudio(audio);
    });

    this.liveClient.on("disconnect", () => {
      this.emit("disconnect");
    });

    this.liveClient.on("reconnect", () => {
      this.emit("reconnect");
    });

    this.liveClient.on("error", (error) => {
      this.emit("error", error);
      if (this.isCalling) {
        this.stopConversation();
      }
    });

    this.liveClient.on("close", (code: number, reason: string) => {
      if (this.isCalling) {
        this.stopConversation();
      }
      this.emit("conversationEnded", { code, reason });
    });

    this.liveClient.on("update", (update) => {
      this.emit("update", update);
    });

    // Not exposed

    this.liveClient.on("clear", () => {
      if (this.isAudioWorkletSupported()) {
        this.audioNode.port.postMessage("clear");
      } else {
        this.audioData = [];
        this.audioDataIndex = 0;
        if (this.isTalking) {
          this.isTalking = false;
          this.emit("agentStopTalking");
        }
      }
    });
  }

  private async setupAudioPlayback(
    sampleRate: number,
    customStream?: MediaStream,
  ): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: sampleRate });
    try {
      this.stream =
        customStream ||
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: sampleRate,
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        }));
    } catch (error) {
      throw new Error("User didn't give microphone permission");
    }

    if (this.isAudioWorkletSupported()) {
      console.log("Audio worklet starting");
      this.audioContext.resume();
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const blobURL = URL.createObjectURL(blob);
      await this.audioContext.audioWorklet.addModule(blobURL);
      console.log("Audio worklet loaded");
      this.audioNode = new AudioWorkletNode(
        this.audioContext,
        "capture-and-playback-processor",
      );
      console.log("Audio worklet setup");

      this.audioNode.port.onmessage = (e) => {
        let data = e.data;
        if (Array.isArray(data)) {
          // capture or playback
          let eventName = data[0];
          if (eventName === "capture") {
            this.liveClient?.send(data[1]);
          } else if (eventName === "playback") {
            this.emit("audio", data[1]);
          }
        } else {
          if (data === "agent_stop_talking") {
            this.emit("agentStopTalking");
          } else if (data === "agent_start_talking") {
            this.emit("agentStartTalking");
          }
        }
      };

      const source = this.audioContext.createMediaStreamSource(this.stream);
      source.connect(this.audioNode);
      this.audioNode.connect(this.audioContext.destination);
    } else {
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.captureNode = this.audioContext.createScriptProcessor(2048, 1, 1);
      this.captureNode.onaudioprocess = (
        audioProcessingEvent: AudioProcessingEvent,
      ) => {
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

          this.emit("audio", convertFloat32ToUint8(outputChannel));
          if (!this.audioData.length && this.isTalking) {
            this.isTalking = false;
            this.emit("agentStopTalking");
          }
        }
      };
      source.connect(this.captureNode);
      this.captureNode.connect(this.audioContext.destination);
    }
  }

  private isAudioWorkletSupported(): boolean {
    return (
      /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor)
    );
  }

  private playAudio(audio: Uint8Array): void {
    if (this.isAudioWorkletSupported()) {
      this.audioNode.port.postMessage(audio);
    } else {
      const float32Data = convertUint8ToFloat32(audio);
      this.audioData.push(float32Data);
      if (!this.isTalking) {
        this.isTalking = true;
        this.emit("agentStartTalking");
      }
    }
  }
}
