import { ControlApi } from "../control/api";
import { CallEndedEvent } from "../types";
import { AudioOptions, CallSession } from "./base-session";
import { SessionHooks } from "./events";

export interface MonitorCallOptions {
  call_id: string;
  hooks?: SessionHooks;
  // Stream the transcript. Default true; false gives an audio-only session.
  transcript?: boolean;
  audio?: AudioOptions;
}

// connecting → monitoring → listening → taken_over → ended
//
// Each step is a user action, not a creation flag: the transcript flows the
// moment the session exists, audio joins when someone clicks "listen", the
// mic opens when someone clicks "take over".
export class MonitorSession extends CallSession {
  public declare readonly callId: string;
  private audio?: AudioOptions;
  private participantId?: string;
  private listening?: Promise<void>;
  private takingOver?: Promise<void>;
  // Set once the take-over request is on its way: from then on the AI leg
  // ending is expected, not the end of our call.
  private takeOverRequested = false;
  // The end frame we survived on the strength of takeOverRequested; if the
  // request then fails (someone else won), it was the real end after all.
  private pendingEnd?: CallEndedEvent;

  constructor(api: ControlApi, options: MonitorCallOptions) {
    super(api, options.hooks);
    this.callId = options.call_id;
    this.audio = options.audio;
    if (options.transcript !== false) this.nodeTransitionSource = "monitor";
    queueMicrotask(() => {
      if (this.ended) return;
      if (options.transcript === false) this.setStatus("monitoring");
      else this.startMonitor(this.callId, true);
    });
  }

  // Join the call's audio, receive-only and hidden. Call from a user gesture:
  // rejects if the browser blocks playback, leaving the session as it was.
  public listen(): Promise<void> {
    if (this.status === "listening" || this.status === "taken_over") {
      return Promise.resolve();
    }
    if (this.ended) return Promise.reject(new Error("Session has ended"));
    if (!this.listening) {
      this.listening = this.doListen().finally(() => {
        this.listening = undefined;
      });
    }
    return this.listening;
  }

  // Drop the audio and go back to transcript only. Not after a take-over:
  // by then our audio is the call.
  public stopListening(): void {
    if (this.status !== "listening") return;
    this.dropTransport();
    this.participantId = undefined;
    this.setStatus("monitoring");
  }

  // Silence the AI and talk to the caller ourselves. Irreversible.
  public takeOver(): Promise<void> {
    if (this.status === "taken_over") return Promise.resolve();
    if (this.ended) return Promise.reject(new Error("Session has ended"));
    if (!this.takingOver) {
      this.takingOver = this.doTakeOver().finally(() => {
        this.takingOver = undefined;
      });
    }
    return this.takingOver;
  }

  // Only meaningful after takeOver(); a listener publishes nothing.
  public mute(): void {
    if (this.status === "taken_over") this.transport?.setMicEnabled(false);
  }

  public unmute(): void {
    if (this.status === "taken_over") this.transport?.setMicEnabled(true);
  }

  // Hang up for everyone. After a take-over there is no AI leg left to stop;
  // our leaving is what ends it.
  public async end(): Promise<void> {
    if (this.ended) return;
    if (this.status !== "taken_over") await this.api.stopCall(this.callId);
    this.disconnect();
  }

  protected onMonitorAttached(): void {
    if (this.status === "connecting") this.setStatus("monitoring");
  }

  // A take-over ends the AI leg, and the backend reports that to every
  // watcher as call_ended (reason call_take_over). When the take-over is
  // ours the call is still going — for us most of all — so only the
  // transcript stream is over; the transport reports the real end. Someone
  // else's take-over ends the session we were watching, listener or not:
  // the transport would not end on its own (the room still has two people).
  protected monitorEnded(event: CallEndedEvent): void {
    // A named reason other than take-over is the caller or the agent hanging
    // up — that ends the call no matter what we were in the middle of. (After
    // a take-over the orchestrator is gone and sends nothing more.)
    const reason = event.disconnection_reason;
    if (reason && reason !== "call_take_over") return this.finish(event);
    if (this.takeOverRequested || this.status === "taken_over") {
      this.pendingEnd = event;
      this.closeMonitor();
      return;
    }
    this.finish(event);
  }

  private async doListen(): Promise<void> {
    let resp;
    try {
      resp = await this.api.listenLiveCall(this.callId);
    } finally {
      this.reportVersion();
    }
    if (this.ended) throw new Error("Session has ended");
    await this.connectTransport({
      accessToken: resp.access_token,
      transport: resp.transport ?? "livekit",
      listener: true,
      callId: this.callId,
      identity: resp.participant_id,
      url: resp.url,
      iceServers: resp.ice_servers,
      baseURL: this.api.host,
      ...this.audio,
    });
    // Connected but inaudible is not "listening": undo and let the caller
    // retry from a gesture.
    try {
      await this.transport?.resumeAudioPlayback();
    } catch (err) {
      this.dropTransport();
      throw new Error(
        `Audio playback blocked; call listen() from a user gesture (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
    }
    this.participantId = resp.participant_id;
    this.setStatus("listening");
  }

  private async doTakeOver(): Promise<void> {
    const joinedForThis = this.status !== "listening";
    if (joinedForThis) await this.listen();
    if (!this.participantId) throw new Error("Not listening");

    // Prompt for the mic before the irreversible step, so a denial fails
    // while the AI is untouched. Held open until the transport has its own
    // track: a device lost in between is unrecoverable.
    let probe: MediaStream;
    try {
      probe = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.audio?.captureDeviceId,
          sampleRate: this.audio?.sampleRate,
          channelCount: 1,
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      // The user asked to take over, not to listen; don't leave them joined.
      if (joinedForThis && !this.ended) {
        this.dropTransport();
        this.participantId = undefined;
        this.setStatus("monitoring");
      }
      throw err;
    }

    let tookOver = false;
    try {
      this.takeOverRequested = true;
      await this.api.takeOverLiveCall(this.callId, this.participantId);
      tookOver = true;
      const transport = this.transport;
      if (this.ended || !transport?.takeOver) {
        throw new Error("Call ended before take-over");
      }
      await transport.takeOver();
    } catch (err) {
      // The AI is already gone; without our mic the caller hears no one.
      if (tookOver) {
        this.fail(err);
      } else {
        this.takeOverRequested = false;
        // The AI-leg end we let pass belonged to someone else's take-over.
        if (this.pendingEnd) this.finish(this.pendingEnd);
      }
      throw err;
    } finally {
      probe.getTracks().forEach((t) => t.stop());
    }
    this.setStatus("taken_over");
  }
}
