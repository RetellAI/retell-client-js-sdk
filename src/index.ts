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
  createAudioAnalyser,
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

export class RetellWebClient extends EventEmitter {
  // Room related
  private room: Room;
  private connected: boolean = false;

  // Helper nodes and variables to analyze and animate based on audio
  public isAgentTalking: boolean = false;

  // Analyser node for agent audio, only available when
  // emitRawAudioSamples is true. Can directly use / modify this for visualization.
  // contains a calculateVolume helper method to get the current volume.
  public analyzerComponent: {
    calculateVolume: () => number;
    analyser: AnalyserNode;
    cleanup: () => Promise<void>;
  };
  private captureAudioFrame: number;

  constructor() {
    super();
  }

  public async startCall(startCallConfig: StartCallConfig): Promise<void> {
    try {
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
      });

      // Register handlers
      this.handleRoomEvents();
      this.handleAudioEvents(startCallConfig);
      this.handleDataEvents();

      // Connect to room
      await this.room.connect(hostUrl, startCallConfig.accessToken);
      console.log("connected to room", this.room.name);

      // Turns microphone track on
      this.room.localParticipant.setMicrophoneEnabled(true);
      this.connected = true;
      this.emit("call_started");
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
    if (!this.connected) return;
    // Cleanup variables and disconnect from room
    this.connected = false;
    this.emit("call_ended");
    this.room?.disconnect();

    this.isAgentTalking = false;
    delete this.room;

    if (this.analyzerComponent) {
      this.analyzerComponent.cleanup();
      delete this.analyzerComponent;
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
    if (!this.connected || !this.analyzerComponent) return;
    let bufferLength = this.analyzerComponent.analyser.fftSize;
    let dataArray = new Float32Array(bufferLength);
    this.analyzerComponent.analyser.getFloatTimeDomainData(dataArray);
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
          // Agent hang up, wait 500ms to hangup call to avoid cutoff last bit of audio
          setTimeout(() => {
            this.stopCall();
          }, 500);
        }
      },
    );

    this.room.on(RoomEvent.Disconnected, () => {
      // room disconnected
      this.stopCall();
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
        if (
          track.kind === Track.Kind.Audio &&
          track instanceof RemoteAudioTrack
        ) {
          if (publication.trackName === "agent_audio") {
            // this is where the agent can start playback
            // can be used to stop loading animation
            this.emit("call_ready");

            if (startCallConfig.emitRawAudioSamples) {
              this.analyzerComponent = createAudioAnalyser(track);
              this.captureAudioFrame = window.requestAnimationFrame(() =>
                this.captureAudioSamples(),
              );
            }
          }

          // Start playing audio for subscribed tracks
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
          } else if (event.event_type === "node_transition") {
            this.emit("node_transition", event);
          }
        } catch (err) {
          console.error("Error decoding data received", err);
        }
      },
    );
  }
}
