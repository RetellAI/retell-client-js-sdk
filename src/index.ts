import { EventEmitter } from "eventemitter3";
import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportKind,
  selectTransport,
} from "./transport";
import { LiveKitTransport } from "./livekit-transport";
import { GatewayTransport } from "./gateway-transport";

export {
  StartCallConfig,
  TransportKind,
  AnalyzerComponent,
} from "./transport";

export interface RetellClientOptions {
  // Fallback transport when a call's config neither specifies nor implies one.
  // Handy for QA to force a transport without backend changes. Default "livekit".
  defaultTransport?: TransportKind;
}

export class RetellWebClient extends EventEmitter {
  private transport?: Transport;
  private connected: boolean = false;
  private defaultTransport: TransportKind;

  // Helper nodes and variables to analyze and animate based on audio
  public isAgentTalking: boolean = false;

  // Analyser node for agent audio, only available when emitRawAudioSamples is
  // true. Can directly use / modify this for visualization. Contains a
  // calculateVolume helper to get the current volume.
  public analyzerComponent?: AnalyzerComponent;
  private captureAudioFrame?: number;

  constructor(options: RetellClientOptions = {}) {
    super();
    this.defaultTransport = options.defaultTransport || "livekit";
  }

  public async startCall(startCallConfig: StartCallConfig): Promise<void> {
    try {
      // A call runs on exactly one transport, chosen once here.
      const kind = selectTransport(startCallConfig, this.defaultTransport);
      this.transport =
        kind === "gateway"
          ? new GatewayTransport(startCallConfig)
          : new LiveKitTransport(startCallConfig);

      await this.transport.connect({
        onConnected: () => {
          if (this.connected) return;
          this.connected = true;
          this.emit("call_started");
        },
        onCallReady: (analyzer) => {
          // Agent audio flowing; can be used to stop a loading animation.
          this.emit("call_ready");
          if (analyzer) {
            this.analyzerComponent = analyzer;
            this.captureAudioFrame = window.requestAnimationFrame(() =>
              this.captureAudioSamples(),
            );
          }
        },
        onData: (event) => this.handleServerEvent(event),
        onDisconnected: () => this.stopCall(),
        onError: (message) => this.emit("error", message),
      });
    } catch (err) {
      this.emit("error", "Error starting call");
      console.error("Error starting call", err);
      // Cleanup
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

    // Always release transport resources (mic, PeerConnection/Room), even if the
    // call failed before it fully connected.
    this.transport?.close();
    this.transport = undefined;

    this.isAgentTalking = false;

    if (this.analyzerComponent) {
      this.analyzerComponent.cleanup();
      this.analyzerComponent = undefined;
    }
    if (this.captureAudioFrame) {
      window.cancelAnimationFrame(this.captureAudioFrame);
      this.captureAudioFrame = undefined;
    }
  }

  // Live-listen take-over: on a receive-only listener call (startCall with
  // listener:true), open the mic and start talking to the caller. Call AFTER the
  // backend take-over succeeds (POST /v2/take-over-live-call), from a user gesture
  // (the mic prompt needs one). No-op on transports without take-over (LiveKit).
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

  // Server-published events (LiveKit today; gateway once it relays orchestrator
  // data onto the WebRTC data channel). Mapping is transport-agnostic.
  private handleServerEvent(event: any): void {
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
