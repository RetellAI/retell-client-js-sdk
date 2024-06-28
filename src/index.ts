import { EventEmitter } from "eventemitter3";
import {
  DataPacket_Kind,
  RemoteParticipant,
  RemoteTrack,
  RemoteAudioTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

const hostUrl = "wss://retell-ai-4ihahnq7.livekit.cloud";
const decoder = new TextDecoder();

export interface StartCallConfig {
  accessToken: string;
  sampleRate?: number;
  captureDeviceId?: string; // specific sink id for audio capture device
  playbackDeviceId?: string; // specific sink id for audio playback device
  emitRawAudioSamples?: boolean; // receive raw float32 audio samples (ex. for animation). Default to false.
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export class RetellWebClient extends EventEmitter {
  // Room related
  private room: Room;
  private connected: boolean = false;

  // Web audio related
  public audioContext: AudioContext;
  public sampleRate: number;

  // Helper nodes and variables to analyze and animate based on audio
  public isAgentTalking: boolean = false;

  // Analyser node for all audio (agent + ambient sound), only available when
  // emitRawAudioSamples is true. Can directly use modify this for visualization.
  private audioAnalyzerNode: AnalyserNode;
  private captureAudioFrame: number;

  constructor() {
    super();
  }

  private getNewAudioContext(
    startCallConfig: StartCallConfig,
  ): AudioContext | null {
    // @ts-ignore
    let audioContextSupported: boolean =
      typeof window !== "undefined" &&
      (window.AudioContext || window.webkitAudioContext);
    if (audioContextSupported) {
      return new AudioContext({
        latencyHint: "interactive",
        sampleRate: startCallConfig.sampleRate,
      });
    }
  }

  public async startCall(startCallConfig: StartCallConfig): Promise<void> {
    try {
      // Create audio context
      const audioContext = this.getNewAudioContext(startCallConfig);
      if (audioContext == null) throw new Error("AudioContext not supported");

      this.audioContext = audioContext;
      if (this.audioContext.state === "suspended") {
        try {
          await this.audioContext.resume();
        } catch (e: any) {
          console.warn("Could not resume audio context", {
            error: e,
          });
          throw new Error("AudioContext cannot be resumed");
        }
      }
      this.sampleRate = this.audioContext.sampleRate;

      // Room options
      this.room = new Room({
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1, // always mono for input
          deviceId: startCallConfig.captureDeviceId,
          sampleRate: startCallConfig.sampleRate,
        },
        audioOutput: {
          deviceId: startCallConfig.playbackDeviceId,
        },
        webAudioMix: {
          audioContext: this.audioContext,
        },
      });

      // Register handlers
      this.handleRoomEvents();
      if (startCallConfig.emitRawAudioSamples) {
        this.audioAnalyzerNode = this.audioContext.createAnalyser();
        this.audioAnalyzerNode.fftSize = 2048;
      }
      this.handleAudioEvents(startCallConfig);
      this.handleDataEvents();

      // Connect to room
      await this.room.connect(hostUrl, startCallConfig.accessToken);
      console.log("connected to room", this.room.name);

      // Turns microphone track on
      this.room.localParticipant.setMicrophoneEnabled(true);
      this.connected = true;
      this.emit("call_started");

      // Start capturing audio samples
      if (startCallConfig.emitRawAudioSamples) {
        this.captureAudioFrame = window.requestAnimationFrame(() =>
          this.captureAudioSamples(),
        );
      }
    } catch (err) {
      this.emit("error", "Error starting call");
      console.error("Error starting call", err);
      // Cleanup
      this.stopCall();
    }
  }

  // Optional.
  // Some browser does not support audio playback without user interaction
  // Call this function inside a click/tap handler to start audio playback
  public async startAudioPlayback() {
    await this.room.startAudio();
  }

  public stopCall(): void {
    // Cleanup variables and disconnect from room
    if (this.connected) {
      this.connected = false;
      this.emit("call_ended");
      this.room?.disconnect();
    }

    this.isAgentTalking = false;
    delete this.room;
    delete this.sampleRate;

    if (this.audioAnalyzerNode) {
      this.audioAnalyzerNode.disconnect();
      delete this.audioAnalyzerNode;
    }

    if (this.audioContext) {
      this.audioContext.close();
      delete this.audioContext;
    }

    if (this.captureAudioFrame) {
      window.cancelAnimationFrame(this.captureAudioFrame);
      delete this.captureAudioFrame;
    }
  }

  public mute(): void {
    if (this.connected) this.room.localParticipant.setMicrophoneEnabled(false);
  }

  public unmute(): void {
    if (this.connected) this.room.localParticipant.setMicrophoneEnabled(true);
  }

  private captureAudioSamples() {
    if (!this.connected || !this.audioAnalyzerNode) return;
    let bufferLength = this.audioAnalyzerNode.fftSize;
    let dataArray = new Float32Array(bufferLength);
    this.audioAnalyzerNode.getFloatTimeDomainData(dataArray);
    this.emit("audio", dataArray);
    this.captureAudioFrame = window.requestAnimationFrame(() =>
      this.captureAudioSamples(),
    );
  }

  private handleRoomEvents(): void {
    this.room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        if (participant?.identity === "server") {
          // Agent hang up
          this.stopCall();
        }
      },
    );

    this.room.on(RoomEvent.Disconnected, () => {
      // room disconnected
      if (this.connected) {
        this.stopCall();
      }
    });
  }

  private handleAudioEvents(startCallConfig: StartCallConfig): void {
    this.room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (track.kind === Track.Kind.Audio) {
          if (
            track instanceof RemoteAudioTrack &&
            startCallConfig.emitRawAudioSamples
          ) {
            track.setWebAudioPlugins([this.audioAnalyzerNode]);
          }

          // Start playing audio
          track.attach();
        }
      },
    );
  }

  private handleDataEvents(): void {
    this.room.on(
      RoomEvent.DataReceived,
      (
        payload: Uint8Array,
        participant?: RemoteParticipant,
        kind?: DataPacket_Kind,
        topic?: string,
      ) => {
        try {
          // parse server data
          if (participant?.identity !== "server") return;

          let decodedData = decoder.decode(payload);
          let event = JSON.parse(decodedData);
          if (event.event_type === "update") {
            this.emit("update", event);
          } else if (event.event_type === "metadata") {
            this.emit("metadata", event);
          } else if (event.event_type === "agent_start_talking") {
            this.isAgentTalking = true;
            this.emit("agent_start_talking");
          } else if (event.event_type === "agent_stop_talking") {
            this.isAgentTalking = false;
            this.emit("agent_stop_talking");
          }
        } catch (err) {
          console.error("Error decoding data received", err);
        }
      },
    );
  }
}
