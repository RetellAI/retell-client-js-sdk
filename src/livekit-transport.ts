// LiveKitTransport: the original LiveKit-backed transport, extracted behind the
// Transport interface. Listener mode and takeOver() mirror GatewayTransport so
// callers drive both the same way.

import {
  LocalAudioTrack,
  ParticipantEvent,
  RemoteAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
  createLocalAudioTrack,
} from "livekit-client";
import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportHandlers,
} from "./transport";

const LIVEKIT_HOST = "wss://retell-ai-4ihahnq7.livekit.cloud";
const PUBLISH_GRANT_TIMEOUT_MS = 5000;
const decoder = new TextDecoder();

export class LiveKitTransport implements Transport {
  private room?: Room;
  private config: StartCallConfig;
  private micTrack?: LocalAudioTrack;
  private readyFired = false;

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

    // A listener is hidden, so after a take-over it can be the only one left
    // holding the room open and the backend's room-delete may never land.
    if (this.config.listener) {
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (room.remoteParticipants.size === 0) handlers.onDisconnected();
      });
    }

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (
          track.kind === Track.Kind.Audio &&
          track instanceof RemoteAudioTrack
        ) {
          // A listener has no agent leg to wait for once the human took over,
          // so any first audio means the call is audible — same as the gateway.
          const ready = this.config.listener
            ? !this.readyFired
            : publication.trackName === "agent_audio";
          if (ready) {
            this.readyFired = true;
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

    await room.connect(this.config.url || LIVEKIT_HOST, this.config.accessToken);
    // A listener publishes nothing until takeOver().
    if (!this.config.listener) {
      room.localParticipant.setMicrophoneEnabled(true);
    }
    handlers.onConnected();
  }

  // The backend must have granted publish first, or the SFU rejects the track.
  public async takeOver(): Promise<void> {
    const room = this.room;
    if (!room) throw new Error("livekit transport not connected");
    if (this.micTrack) return; // already publishing (took over already)

    const track = await createLocalAudioTrack({
      deviceId: this.config.captureDeviceId,
      sampleRate: this.config.sampleRate,
      channelCount: 1,
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
    try {
      await this.waitForPublishGrant(room);
      await room.localParticipant.publishTrack(track);
      this.micTrack = track;
    } catch (err) {
      track.stop();
      throw err;
    }
  }

  // The grant arrives as an async SFU push after the backend's 200; publishing
  // before it lands is a 403.
  private waitForPublishGrant(room: Room): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        room.localParticipant.off(
          ParticipantEvent.ParticipantPermissionsChanged,
          onGrant,
        );
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error("Timed out waiting for publish permission"));
      }, PUBLISH_GRANT_TIMEOUT_MS);
      const onGrant = () => {
        if (!room.localParticipant.permissions?.canPublish) return;
        done();
        resolve();
      };
      // Register before checking: a grant landing in between would be missed.
      room.localParticipant.on(
        ParticipantEvent.ParticipantPermissionsChanged,
        onGrant,
      );
      if (room.localParticipant.permissions?.canPublish) {
        done();
        resolve();
      }
    });
  }

  public setMicEnabled(enabled: boolean): void {
    // After a take-over the mic is a track we own, not the room's default one.
    if (this.micTrack) {
      void (enabled ? this.micTrack.unmute() : this.micTrack.mute());
      return;
    }
    this.room?.localParticipant.setMicrophoneEnabled(enabled);
  }

  public async resumeAudioPlayback(): Promise<void> {
    await this.room?.startAudio();
  }

  public close(): void {
    this.micTrack?.stop();
    this.micTrack = undefined;
    this.room?.disconnect();
    this.room = undefined;
    this.readyFired = false;
  }
}
