// LiveKitTransport: the original LiveKit-backed transport, extracted behind the
// Transport interface with NO behavior change. Default transport.

import {
  RemoteAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
} from "livekit-client";
import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportHandlers,
} from "./transport";

const LIVEKIT_HOST = "wss://retell-ai-4ihahnq7.livekit.cloud";
const decoder = new TextDecoder();

export class LiveKitTransport implements Transport {
  private room?: Room;
  private config: StartCallConfig;

  constructor(config: StartCallConfig) {
    this.config = config;
  }

  public async connect(handlers: TransportHandlers): Promise<void> {
    if (!this.config.accessToken) {
      throw new Error("accessToken is required for the livekit transport");
    }

    const room = new Room({
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1, // always mono for input
        deviceId: this.config.captureDeviceId,
        sampleRate: this.config.sampleRate,
      },
      audioOutput: {
        deviceId: this.config.playbackDeviceId,
      },
    });
    this.room = room;

    room.on(RoomEvent.Disconnected, () => handlers.onDisconnected());

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (
          track.kind === Track.Kind.Audio &&
          track instanceof RemoteAudioTrack
        ) {
          if (publication.trackName === "agent_audio") {
            let analyzer: AnalyzerComponent | null = null;
            if (this.config.emitRawAudioSamples) {
              analyzer = createAudioAnalyser(track) as AnalyzerComponent;
            }
            handlers.onCallReady(analyzer);
          }
          track.attach();
        }
      },
    );

    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant) => {
      if (participant?.identity !== "server") return;
      try {
        handlers.onData(JSON.parse(decoder.decode(payload)));
      } catch (err) {
        console.error("Error decoding data received", err);
      }
    });

    await room.connect(LIVEKIT_HOST, this.config.accessToken);
    room.localParticipant.setMicrophoneEnabled(true);
    handlers.onConnected();
  }

  public setMicEnabled(enabled: boolean): void {
    this.room?.localParticipant.setMicrophoneEnabled(enabled);
  }

  public async resumeAudioPlayback(): Promise<void> {
    await this.room?.startAudio();
  }

  public close(): void {
    this.room?.disconnect();
    this.room = undefined;
  }
}
