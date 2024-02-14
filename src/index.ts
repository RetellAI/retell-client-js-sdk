// retell-client-sdk.ts
import { AudioWsClient } from "./audioWsClient";
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
  private audioNode: AudioWorkletNode;

  constructor() {
    super();
  }

  public async startConversation(
    startConversationConfig: StartConversationConfig,
  ): Promise<void> {
    try {
      await this.setupAudio(
        startConversationConfig.sampleRate,
        startConversationConfig.customStream,
      );
      this.liveClient = new AudioWsClient({
        callId: startConversationConfig.callId,
        enableUpdate: startConversationConfig.enableUpdate,
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
    this.audioNode?.disconnect();
    delete this.audioNode; // Prevent memory leak by detaching the event handler
    this.audioContext?.close(); // Properly close the audio context to release system audio resources
    this.stream?.getTracks().forEach((track) => track.stop());

    // Release references to allow for garbage collection
    delete this.liveClient;
    delete this.audioContext;
    delete this.stream;
  }

  private async setupAudio(
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
        if (this.liveClient != null) {
            this.liveClient.send(e.data);
        }
    };

    const source = this.audioContext.createMediaStreamSource(this.stream);
    source.connect(this.audioNode);
    this.audioNode.connect(this.audioContext.destination);
  }

  private handleAudioEvents(): void {
    // Exposed
    this.liveClient.on("open", () => {
      this.emit("conversationStarted");
    });

    this.liveClient.on("audio", (audio: Uint8Array) => {
      this.audioNode.port.postMessage(audio);
      this.emit("audio", audio);
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
      this.audioNode.port.postMessage("clear");
    });
  }
}
