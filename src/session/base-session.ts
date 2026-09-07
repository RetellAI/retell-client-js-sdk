import { EventEmitter } from "eventemitter3";
import { ControlApi, versionMessage } from "../control/api";
import { MonitorSocket } from "../control/monitor-socket";
import { GatewayTransport } from "../gateway-transport";
import { LiveKitTransport } from "../livekit-transport";
import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  selectTransport,
} from "../transport";
import {
  CallEndedEvent,
  LiveCallNodeTransition,
  LiveCallUtterance,
  UpdateLiveCallRequest,
} from "../types";
import {
  DATA_CHANNEL_EVENTS,
  HOOK_EVENTS,
  MONITOR_EVENTS,
  SessionEventMap,
  SessionHooks,
  SessionStatus,
} from "./events";
import { TranscriptStore } from "./transcript";

export interface AudioOptions {
  sampleRate?: number;
  captureDeviceId?: string; // mic
  playbackDeviceId?: string; // speaker sink id
  // Emit `audio` analyser snapshots for visualization. Not contiguous PCM.
  emitRawAudioSamples?: boolean;
}

// One call, from the caller's point of view. Owns whichever of the two paths
// the call uses — media (transport) and control (monitor stream) — and turns
// both into one event stream. Constructors never emit synchronously, so hooks
// passed at creation see everything.
export abstract class CallSession extends EventEmitter<SessionEventMap> {
  public status: SessionStatus = "connecting";
  public callId?: string;
  public isAgentTalking = false;
  // Only with audio.emitRawAudioSamples; has a calculateVolume helper.
  public analyzerComponent?: AnalyzerComponent;
  // Settles when the session leaves `connecting`. Rejections are also
  // delivered as `error`, so awaiting this is optional.
  public readonly ready: Promise<void>;

  protected transport?: Transport;
  protected ended = false;
  // A transition can arrive on both paths; each session type picks one.
  protected nodeTransitionSource: "data" | "monitor" = "data";
  private socket?: MonitorSocket;
  private store = new TranscriptStore();
  private captureAudioFrame?: number;
  private unknownWarned = new Set<string>();
  private versionReported = false;
  private settleReady!: { resolve: () => void; reject: (e: Error) => void };

  constructor(
    protected api: ControlApi,
    hooks?: SessionHooks,
  ) {
    super();
    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = { resolve, reject };
    });
    this.ready.catch(() => {}); // never an unhandled rejection on its own
    if (hooks) {
      for (const hook of Object.keys(HOOK_EVENTS) as (keyof SessionHooks)[]) {
        const fn = hooks[hook];
        if (fn) this.on(HOOK_EVENTS[hook], fn as (...args: any[]) => void);
      }
    }
  }

  public get transcript(): LiveCallUtterance[] {
    return this.store.transcript;
  }

  public get preSessionTranscript(): LiveCallUtterance[] {
    return this.store.preSessionTranscript;
  }

  // Hang up the call.
  public abstract end(): Promise<void>;

  // Leave. A monitored call goes on without us — unless we took it over, in
  // which case the backend ends it once we're gone.
  public disconnect(): void {
    this.finish({});
  }

  public async update(body: UpdateLiveCallRequest): Promise<void> {
    if (!this.callId) throw new Error("Call not created yet");
    await this.api.updateLiveCall(this.callId, body);
  }

  // Browsers may block playback until a user gesture; call from a click.
  public async startAudioPlayback(): Promise<void> {
    await this.transport?.resumeAudioPlayback();
  }

  protected setStatus(status: SessionStatus): void {
    if (this.ended) return;
    this.status = status;
    this.emit("status", status);
    if (status !== "connecting") this.settleReady.resolve();
  }

  protected fail(err: unknown): void {
    if (this.ended) return;
    const error = toError(err);
    this.emit("error", error);
    this.settleReady.reject(error);
    this.finish({});
  }

  protected finish(event: CallEndedEvent): void {
    if (this.ended) return;
    this.ended = true;
    this.closeMonitor();
    this.dropTransport();
    this.status = "ended";
    this.emit("status", "ended");
    this.settleReady.reject(new Error("Session ended before it was ready"));
    this.emit("end", event);
  }

  protected async connectTransport(config: StartCallConfig): Promise<void> {
    const kind = selectTransport(config, "livekit");
    const transport =
      kind === "gateway"
        ? new GatewayTransport(config)
        : new LiveKitTransport(config);
    this.transport = transport;
    // A transport we already dropped may still report (LiveKit emits
    // Disconnected from its own disconnect()); only the current one counts.
    const current = () => this.transport === transport;
    try {
      await transport.connect({
        onConnected: () => {},
        onCallReady: (analyzer) => {
          if (!analyzer || this.ended || !current()) return;
          this.analyzerComponent = analyzer;
          this.captureAudioFrame = requestAnimationFrame(() =>
            this.captureAudioSamples(),
          );
        },
        onData: (event) => {
          if (current()) this.handleDataEvent(event);
        },
        onDisconnected: () => {
          if (current()) this.finish({});
        },
        // Not terminal on its own; the transport decides whether to drop.
        onError: (message) => {
          if (current()) this.emit("error", new Error(message));
        },
      });
    } catch (err) {
      if (this.transport === transport) this.dropTransport();
      else transport.close();
      throw err;
    }
    if (this.ended) throw new Error("Session has ended");
  }

  // So a below-minimum SDK reaches error tracking, not just the console.
  protected reportVersion(): void {
    const v = this.api.version;
    if (this.versionReported || !v || v.level !== "min") return;
    this.versionReported = true;
    this.emit("error", new Error(versionMessage(v)));
  }

  protected dropTransport(): void {
    this.transport?.close();
    this.transport = undefined;
    this.isAgentTalking = false;
    if (this.analyzerComponent) {
      this.analyzerComponent.cleanup().catch(() => {});
      this.analyzerComponent = undefined;
    }
    if (this.captureAudioFrame !== undefined) {
      cancelAnimationFrame(this.captureAudioFrame);
      this.captureAudioFrame = undefined;
    }
  }

  // `fatal` when the transcript is the session's purpose, not an extra.
  protected startMonitor(callId: string, fatal: boolean): void {
    const { url, protocols } = this.api.monitorSocket(callId);
    this.socket = new MonitorSocket(url, protocols, {
      onMessage: (msg) => this.handleMonitorEvent(msg),
      onEnd: () => this.monitorEnded({}),
      onError: (err) => {
        if (fatal) this.fail(err);
        else console.warn("retell: live transcript unavailable:", err.message);
      },
    });
    this.socket.open();
  }

  protected closeMonitor(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  // First frame from the monitor stream; the call is live.
  protected onMonitorAttached(): void {}

  // The monitor stream says the call ended. Usually that is the end of the
  // session too; subclasses know when it isn't.
  protected monitorEnded(event: CallEndedEvent): void {
    this.finish(event);
  }

  private handleDataEvent(event: any): void {
    // The gateway's control channel uses its own envelope, not `event_type`.
    if (event?.type === "status") {
      if (event.state === "ended" || event.state === "replaced") this.finish({});
      return;
    }
    const name = DATA_CHANNEL_EVENTS[event?.event_type];
    if (!name) return this.dropUnknown("data", event?.event_type);
    if (name === "node_transition" && this.nodeTransitionSource !== "data") {
      return;
    }
    if (name === "agent_start_talking") {
      this.isAgentTalking = true;
      this.emit(name);
    } else if (name === "agent_stop_talking") {
      this.isAgentTalking = false;
      this.emit(name);
    } else {
      this.emit(name, event);
    }
  }

  private handleMonitorEvent(msg: any): void {
    const name = MONITOR_EVENTS[msg?.type];
    if (!name) return this.dropUnknown("monitor", msg?.type);
    this.onMonitorAttached();
    if (name === "transcript") {
      const fresh = this.store.merge(msg.transcripts, msg.pre_session_transcripts);
      this.emit("transcript", this.transcript, this.preSessionTranscript);
      if (this.nodeTransitionSource !== "monitor") return;
      for (const item of fresh) {
        if (item.role === "node_transition") {
          this.emit("node_transition", item as LiveCallNodeTransition);
        }
      }
    } else {
      const { type, ...event } = msg;
      this.monitorEnded(event);
    }
  }

  // Once per name: a newer backend may send events this version doesn't know.
  private dropUnknown(source: "data" | "monitor", type: unknown): void {
    const key = `${source}:${String(type)}`;
    if (this.unknownWarned.has(key)) return;
    this.unknownWarned.add(key);
    console.debug(
      `retell-client-js-sdk: ignoring unknown ${source} event "${String(type)}" — not supported by this SDK version`,
    );
  }

  private captureAudioSamples(): void {
    if (this.ended || !this.analyzerComponent) return;
    const data = new Float32Array(this.analyzerComponent.analyser.fftSize);
    this.analyzerComponent.analyser.getFloatTimeDomainData(data);
    this.emit("audio", data);
    this.captureAudioFrame = requestAnimationFrame(() =>
      this.captureAudioSamples(),
    );
  }
}

export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error");
}
