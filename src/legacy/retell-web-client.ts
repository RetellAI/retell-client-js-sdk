import { EventEmitter } from "eventemitter3";
import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportKind,
  selectTransport,
} from "../transport";
import { LiveKitTransport } from "../livekit-transport";
import { GatewayTransport } from "../gateway-transport";

// The 2.x client, kept so existing integrations upgrade without changes.
// Media only: bring your own access_token from create-web-call.

/** @deprecated Use `RetellClientConfig` with `RetellClient`. */
export interface RetellClientOptions {
  // Used when a call's config neither specifies nor implies a transport.
  defaultTransport?: TransportKind;
}

/**
 * @deprecated Use `RetellClient` — `createWebCall()` / `monitorCall()` handle
 * the API calls, transcript and take-over ordering for you. Removed in 4.0.
 */
export class RetellWebClient extends EventEmitter {
  private transport?: Transport;
  private connected: boolean = false;
  private defaultTransport: TransportKind;

  // Helper nodes and variables to analyze and animate based on audio
  public isAgentTalking: boolean = false;

  // Analyser node for agent audio, only available when emitRawAudioSamples is
  // true. Can directly use / modify this for visualization. Contains a
  // calculateVolume helper to get the current volume.
  // Declared as in 2.0.8 (non-optional) so strict consumers keep compiling;
  // it is only set between call_ready and stopCall.
  public analyzerComponent!: AnalyzerComponent;
  private captureAudioFrame?: number;

  constructor(options: RetellClientOptions = {}) {
    super();
    this.defaultTransport = options.defaultTransport || "livekit";
  }

  public async startCall(startCallConfig: StartCallConfig): Promise<void> {
    let transport: Transport | undefined;
    // A transport we already dropped may still report (LiveKit emits
    // Disconnected from its own disconnect(), after the next call has begun);
    // only the current one counts. 2.0.8 got the same protection from the
    // `connected` flag, which stopCall() no longer waits for.
    const current = () => this.transport === transport;

    try {
      const kind = selectTransport(startCallConfig, this.defaultTransport);
      transport =
        kind === "gateway"
          ? new GatewayTransport(startCallConfig)
          : new LiveKitTransport(startCallConfig);
      this.transport = transport;

      await transport.connect({
        onConnected: () => {
          if (!current() || this.connected) return;
          this.connected = true;
          this.emit("call_started");
        },
        onCallReady: (analyzer) => {
          if (!current()) return;
          this.emit("call_ready");
          if (analyzer) {
            this.analyzerComponent = analyzer;
            this.captureAudioFrame = window.requestAnimationFrame(() =>
              this.captureAudioSamples(),
            );
          }
        },
        onData: (event) => {
          if (current()) this.handleServerEvent(event);
        },
        onDisconnected: () => {
          if (current()) this.stopCall();
        },
        onError: (message) => {
          if (current()) this.emit("error", message);
        },
      });
    } catch (err) {
      // stopCall() during connect closes the transport, which makes connect
      // reject: that is the user's cancel, not an error (silent in 2.0.8).
      if (transport && !current()) return;
      this.emit("error", "Error starting call");
      console.error("Error starting call", err);
      this.stopCall();
    }
  }

  // Optional.
  // Some browsers do not support audio playback without user interaction.
  // Call this function inside a click/tap handler to start audio playback.
  public async startAudioPlayback(): Promise<void> {
    await this.transport?.resumeAudioPlayback();
  }

  public stopCall(): void {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.emit("call_ended");

    // Release mic / PeerConnection even if the call never fully connected.
    this.transport?.close();
    this.transport = undefined;

    this.isAgentTalking = false;

    if (this.analyzerComponent) {
      this.analyzerComponent.cleanup();
      (this as { analyzerComponent?: AnalyzerComponent }).analyzerComponent =
        undefined;
    }
    if (this.captureAudioFrame) {
      window.cancelAnimationFrame(this.captureAudioFrame);
      this.captureAudioFrame = undefined;
    }
  }

  // Call after the backend take-over succeeds, from a user gesture (the mic
  // prompt needs one). No-op on LiveKit.
  public async takeOver(): Promise<void> {
    await this.transport?.takeOver?.();
  }

  public mute(): void {
    if (this.connected) this.transport?.setMicEnabled(false);
  }

  public unmute(): void {
    if (this.connected) this.transport?.setMicEnabled(true);
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

  private handleServerEvent(event: any): void {
    // The gateway's control channel uses its own envelope, not `event_type`.
    if (event?.type === "status") {
      if (event.state === "ended" || event.state === "replaced") {
        this.stopCall();
      }
      return;
    }

    if (event?.event_type === "update") {
      this.emit("update", event);
    } else if (event?.event_type === "metadata") {
      this.emit("metadata", event);
    } else if (event?.event_type === "agent_start_talking") {
      this.isAgentTalking = true;
      this.emit("agent_start_talking");
    } else if (event?.event_type === "agent_stop_talking") {
      this.isAgentTalking = false;
      this.emit("agent_stop_talking");
    } else if (event?.event_type === "node_transition") {
      this.emit("node_transition", event);
    }
  }
}
