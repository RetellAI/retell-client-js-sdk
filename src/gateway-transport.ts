import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportHandlers,
} from "./transport";
import { SDK_VERSION } from "./version";

// Live-listen needs this: with no mic grant Chrome offers only .local mDNS
// candidates, unroutable outside its own network.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

// The identity create-web-call mints the browser token for. The gateway rejects a
// join whose identity doesn't match the token's claim, so this is the only
// workable default — live-listen passes its own.
const WEB_CALL_IDENTITY = "client";

// Signaling goes to Retell, which relays it to the gateway holding the call:
// gateways answer on a private address, so a browser cannot reach one. Media does
// not come back through here — it goes straight to whatever the SDP answer
// advertises. Known the same way LIVEKIT_HOST is; `baseURL` overrides it for
// local development.
const RETELL_API_HOST = "https://api.retellai.com";
const WEBRTC_PROXY_PREFIX = "/webrtc-proxy";

// Mobile networks (Verizon Android especially) often drop for a few seconds
// right as a call starts. Signaling retries on network errors within this window.
const WHIP_RETRY_WINDOW_MS = 20_000;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 4_000;
// Per-attempt timeouts: after a network change the first request often hangs on
// a dead pooled connection rather than failing fast. The POST's is generous: a
// slow one aborted and retried can still land and displace the retry's session.
const POST_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
// Floor near a deadline, so the last try can finish.
const MIN_REQUEST_MS = 2_000;

// ICE restart after a drop: debounce a transient "disconnected", then keep
// restarting until connected or the window closes. The gateway closes a session
// ~10s after media stops (5s to Disconnected plus a 5s grace), so restart
// requests get a short timeout to leave room for another try.
const ICE_RESTART_DEBOUNCE_MS = 1_000;
const ICE_RESTART_WINDOW_MS = 15_000;
const ICE_RESTART_CHECK_MS = 5_000;
const ICE_RESTART_REQUEST_MS = 3_000;

export class GatewayTransport implements Transport {
  private config: StartCallConfig;
  private base: string;
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private localStream?: MediaStream;
  // Take-over's mic until it is published: close() must stop it even if the
  // negotiation it waits on never settles on the closed connection.
  private takeOverStream?: MediaStream;
  private takingOver?: Promise<void>;
  private recovering?: Promise<void>;
  // Serializes offer/answer rounds: take-over and ICE restart both renegotiate,
  // and a second local offer would clobber the first.
  private negotiating: Promise<void> = Promise.resolve();
  // Releases queued negotiations on close(): the round holding the lock may be
  // awaiting a pc operation that never settles once the pc is closed.
  private markClosed!: () => void;
  private closed = new Promise<void>((resolve) => (this.markClosed = resolve));
  private aborts = new Set<AbortController>();
  private iceConnected = false;
  // Recovery gave up: close() leaves the session for the gateway to close as
  // connection_lost instead of reporting a hangup with DELETE.
  private connectionLost = false;
  // Set while an ICE-restart offer is in flight: its candidates must not reach
  // the gateway before the offer, whose restart would discard them.
  private holdCandidates = false;
  private audioEl?: HTMLAudioElement;
  private analyzer?: AnalyzerComponent;
  private sessionId?: string;
  private pendingCandidates: RTCIceCandidate[] = [];
  private handlers?: TransportHandlers;
  private readyFired = false;

  constructor(config: StartCallConfig) {
    this.config = config;
    const host = (config.baseURL || RETELL_API_HOST).replace(/\/+$/, "");
    this.base = `${host}${WEBRTC_PROXY_PREFIX}/${config.callId}`;
  }

  public async connect(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers;
    if (!this.config.callId) {
      throw new Error("callId is required for the gateway transport");
    }

    const pc = new RTCPeerConnection({
      iceServers: this.config.iceServers?.length
        ? this.config.iceServers
        : DEFAULT_ICE_SERVERS,
    });
    this.pc = pc;

    if (this.config.listener) {
      pc.addTransceiver("audio", { direction: "recvonly" });
    } else {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: this.micConstraints(),
      });
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    }

    // Not used yet — the gateway does not relay orchestrator data onto it — but
    // wired so that stays a drop-in.
    const dc = pc.createDataChannel("control");
    this.dc = dc;
    dc.onmessage = (ev) => {
      try {
        handlers.onData(JSON.parse(ev.data));
      } catch {
        /* ignore non-JSON control frames */
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      this.attachRemote(stream, ev.track);
      if (!this.readyFired) {
        this.readyFired = true;
        handlers.onCallReady(this.analyzer || null);
      }
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      if (!this.sessionId || this.holdCandidates) {
        this.pendingCandidates.push(ev.candidate);
        return;
      }
      this.sendCandidate(ev.candidate);
    };
    // Before onConnected a failure surfaces as connect() rejecting; reporting
    // it as a disconnect as well would end the session before the error
    // reaches anyone. Same rule as the LiveKit transport.
    let connected = false;
    // Once media has flowed, a drop is recovered with an ICE restart rather than
    // ending the call; recover() reports the disconnect if that fails.
    const onState = (s: string) => {
      // Not ICE alone: a DTLS failure after ICE connects is not a network drop.
      if (isConnected(pc)) this.iceConnected = true;
      if (!connected) return;
      if (s === "closed") {
        handlers.onDisconnected();
      } else if (s === "disconnected" || s === "failed") {
        if (this.iceConnected) this.recover(pc);
        else if (s === "failed") handlers.onDisconnected();
      }
    };
    pc.onconnectionstatechange = () => onState(pc.connectionState);
    // For browsers without connectionState (Firefox < 113). Harmless alongside
    // the above: recover() and onDisconnected are idempotent.
    pc.oniceconnectionstatechange = () => onState(pc.iceConnectionState);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answer = await this.createSession(pc, pc.localDescription!.sdp);
    this.sessionId = answer.session_id;

    // Before the answer: setRemoteDescription fires ontrack synchronously, and
    // call_started must precede call_ready.
    connected = true;
    handlers.onConnected();

    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

    const flush = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of flush) this.sendCandidate(c);
  }

  // The browser may arrive before the agent — create-web-call only queues that
  // join — and the gateway creates the room for a valid token, so there is
  // nothing to wait for. Retrying is safe: the gateway treats a repeat POST for
  // the same identity as a reconnect and closes the session it displaces.
  private async createSession(
    pc: RTCPeerConnection,
    sdp: string,
  ): Promise<{ session_id: string; sdp: string }> {
    const deadline = Date.now() + WHIP_RETRY_WINDOW_MS;
    for (let attempt = 0; ; attempt++) {
      if (this.pc !== pc) throw new Error("gateway transport closed");
      let resp: Response;
      let body: string;
      try {
        ({ resp, body } = await this.request(
          this.base + "/v1/webrtc/sessions",
          {
            method: "POST",
            headers: this.headers({ "Content-Type": "application/json" }),
            // No room coordinates: Retell fills them in from the call record, so the
            // browser never has to be told which room its call lives in.
            body: JSON.stringify({ identity: this.identity(), sdp }),
          },
          Math.min(deadline, Date.now() + POST_TIMEOUT_MS),
        ));
      } catch (err) {
        if (this.pc !== pc) throw new Error("gateway transport closed");
        if (!isNetworkError(err) || Date.now() >= deadline) throw err;
        await retryDelay(attempt, deadline);
        continue;
      }
      // 504 is left alone: the first POST may still be running on the gateway,
      // and landing after a retry it would displace the retry's session.
      if ((resp.status === 502 || resp.status === 503) && Date.now() < deadline) {
        await retryDelay(attempt, deadline);
        continue;
      }
      if (!resp.ok) {
        throw new Error(`gateway WHIP POST failed: ${resp.status} ${body}`);
      }
      const answer = JSON.parse(body);
      if (this.pc !== pc) {
        this.deleteSession(answer.session_id);
        throw new Error("gateway transport closed");
      }
      return answer;
    }
  }

  // fetch plus body read, bounded by the per-attempt deadline and cancelled
  // by close(): a stalled mobile connection would otherwise hang it for minutes.
  private async request(
    url: string,
    init: RequestInit,
    deadline: number,
  ): Promise<{ resp: Response; body: string }> {
    const ctrl = new AbortController();
    this.aborts.add(ctrl);
    const ms = Math.max(deadline - Date.now(), MIN_REQUEST_MS);
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const resp = await fetch(url, { ...init, signal: ctrl.signal });
      return { resp, body: await resp.text() };
    } finally {
      clearTimeout(timer);
      this.aborts.delete(ctrl);
    }
  }

  private withNegotiation<T>(fn: () => Promise<T>): Promise<T> {
    const run = Promise.race([this.negotiating, this.closed]).then(fn, fn);
    this.negotiating = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private recover(pc: RTCPeerConnection): void {
    if (this.recovering) return;
    this.recovering = this.doRecover(pc).finally(() => {
      this.recovering = undefined;
    });
  }

  // The gateway only answers, so only the browser can restart ICE. A restart
  // gathers fresh candidates, which is what survives the phone's address or NAT
  // mapping changing — the case where every existing path dies at once.
  private async doRecover(pc: RTCPeerConnection): Promise<void> {
    const deadline = Date.now() + ICE_RESTART_WINDOW_MS;
    await sleep(ICE_RESTART_DEBOUNCE_MS);
    for (let attempt = 0; this.pc === pc && Date.now() < deadline; attempt++) {
      if (isConnected(pc)) return;
      const outcome = await this.withNegotiation(() =>
        this.restartIce(pc, deadline),
      );
      if (outcome === "gone") break;
      if (outcome === "ok") {
        const wait = Math.min(ICE_RESTART_CHECK_MS, deadline - Date.now());
        if (await waitConnected(pc, wait)) return;
      } else {
        await retryDelay(attempt, deadline);
      }
    }
    if (this.pc === pc && !isConnected(pc)) {
      this.connectionLost = true;
      this.handlers?.onDisconnected();
    }
  }

  // One ICE restart round, under the negotiation lock. "gone" means the gateway
  // no longer has the session.
  private async restartIce(
    pc: RTCPeerConnection,
    deadline: number,
  ): Promise<"ok" | "retry" | "gone"> {
    if (this.pc !== pc) return "gone";
    if (pc.signalingState !== "stable") return "retry";
    this.holdCandidates = true;
    const outcome = await this.sendRestartOffer(pc, deadline);
    this.holdCandidates = false;
    // Held candidates belong to this offer: useless if it was rolled back.
    const held = this.pendingCandidates;
    this.pendingCandidates = [];
    if (outcome === "ok") for (const c of held) this.sendCandidate(c);
    return outcome;
  }

  private async sendRestartOffer(
    pc: RTCPeerConnection,
    deadline: number,
  ): Promise<"ok" | "retry" | "gone"> {
    try {
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      if (this.pc !== pc) return "gone";
      const { resp, body: answer } = await this.request(
        `${this.base}/v1/webrtc/sessions/${this.sessionId}`,
        {
          method: "PATCH",
          headers: this.headers({ "Content-Type": "application/sdp" }),
          body: pc.localDescription!.sdp,
        },
        Math.min(deadline, Date.now() + ICE_RESTART_REQUEST_MS),
      );
      if (!resp.ok) {
        await rollback(pc);
        return resp.status === 403 || resp.status === 404 ? "gone" : "retry";
      }
      if (this.pc !== pc) return "gone";
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      return "ok";
    } catch (err) {
      console.error("gateway ICE restart failed", err);
      await rollback(pc);
      return this.pc === pc ? "retry" : "gone";
    }
  }

  // Local track toggle, distinct from the server-side mute.
  public setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  // The backend must have promoted the session first, or the gateway drops the
  // uplink regardless.
  public async takeOver(): Promise<void> {
    if (!this.pc) throw new Error("gateway transport not connected");
    if (this.localStream) return;
    if (!this.takingOver) {
      this.takingOver = this.doTakeOver(this.pc).finally(() => {
        this.takingOver = undefined;
      });
    }
    return this.takingOver;
  }

  private async doTakeOver(
    pc: RTCPeerConnection,
    canRetry = true,
  ): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: this.micConstraints(),
    });
    if (this.pc !== pc) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("gateway transport closed");
    }
    this.takeOverStream = stream;
    const track = stream.getAudioTracks()[0];

    // Under the negotiation lock from the transceiver change through answer or
    // rollback, so an ICE restart can't interleave its own offer.
    const retry = await this.withNegotiation(async () => {
      // Reuse the existing transceiver to keep a single audio m-line.
      const audioTx = pc
        .getTransceivers()
        .find((t) => t.direction === "recvonly");
      let addedSender: RTCRtpSender | undefined;
      let retryable = false;
      try {
        if (audioTx) {
          await audioTx.sender.replaceTrack(track);
          audioTx.direction = "sendrecv";
        } else {
          addedSender = pc.addTrack(track, stream);
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        let answer: string;
        try {
          // Bounded: it holds the negotiation lock, which recovery needs.
          const { resp, body } = await this.request(
            `${this.base}/v1/webrtc/sessions/${this.sessionId}`,
            {
              method: "PATCH",
              headers: this.headers({ "Content-Type": "application/sdp" }),
              body: pc.localDescription!.sdp,
            },
            Date.now() + REQUEST_TIMEOUT_MS,
          );
          retryable = resp.status >= 500 && resp.status < 600;
          answer = body;
          if (!resp.ok) {
            throw new Error(
              `gateway take-over renegotiation failed: ${resp.status} ${answer}`,
            );
          }
        } catch (err) {
          retryable = retryable || isNetworkError(err);
          throw err;
        }
        await pc.setRemoteDescription({
          type: "answer",
          sdp: answer,
        });
        if (this.pc !== pc) throw new Error("gateway transport closed");
        return false;
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        const rolledBack = await this.undoTakeOver(pc, audioTx, addedSender);
        if (canRetry && retryable && rolledBack && this.pc === pc) return true;
        throw err;
      } finally {
        if (this.takeOverStream === stream) this.takeOverStream = undefined;
      }
    });
    // Retried outside the lock, which doTakeOver takes again.
    if (retry) return this.doTakeOver(pc, false);
    if (this.pc !== pc) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("gateway transport closed");
    }
    // Set localStream last because takeOver() treats localStream as a published microphone.
    this.localStream = stream;
  }

  private async undoTakeOver(
    pc: RTCPeerConnection,
    audioTx: RTCRtpTransceiver | undefined,
    addedSender: RTCRtpSender | undefined,
  ): Promise<boolean> {
    if (pc.signalingState === "closed") return false;
    try {
      if (pc.signalingState === "have-local-offer") {
        await pc.setLocalDescription({ type: "rollback" });
      }
      if (audioTx) {
        audioTx.direction = "recvonly";
        await audioTx.sender.replaceTrack(null);
      } else if (addedSender) {
        pc.removeTrack(addedSender);
      }
      return true;
    } catch (err) {
      console.error("gateway take-over rollback failed", err);
      return false;
    }
  }

  private micConstraints(): MediaTrackConstraints {
    return {
      deviceId: this.config.captureDeviceId,
      sampleRate: this.config.sampleRate,
      channelCount: 1,
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    };
  }

  public async resumeAudioPlayback(): Promise<void> {
    await this.audioEl?.play();
  }

  public close(): void {
    this.markClosed();
    this.aborts.forEach((c) => c.abort());
    this.aborts.clear();
    if (this.sessionId && !this.connectionLost) {
      this.deleteSession(this.sessionId);
    }
    try {
      this.dc?.close();
    } catch {
      /* noop */
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.takeOverStream?.getTracks().forEach((t) => t.stop());
    this.takeOverStream = undefined;
    try {
      this.pc?.close();
    } catch {
      /* noop */
    }
    this.analyzer?.cleanup().catch(() => {});
    this.pc = undefined;
    this.dc = undefined;
    this.localStream = undefined;
    this.audioEl = undefined;
    this.analyzer = undefined;
    this.sessionId = undefined;
  }

  // Fire-and-forget so close() stays synchronous.
  private deleteSession(sessionId: string): void {
    fetch(`${this.base}/v1/webrtc/sessions/${sessionId}`, {
      method: "DELETE",
      headers: this.headers(),
    }).catch(() => {});
  }

  private identity(): string {
    return this.config.identity || WEB_CALL_IDENTITY;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "X-Retell-Client-JS-SDK-Version": SDK_VERSION,
      ...(extra || {}),
    };
    if (this.config.accessToken) {
      h["Authorization"] = "Bearer " + this.config.accessToken;
    }
    return h;
  }

  private async sendCandidate(candidate: RTCIceCandidate): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(`${this.base}/v1/webrtc/sessions/${this.sessionId}`, {
        method: "PATCH",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ candidate: candidate.toJSON() }),
      });
    } catch (err) {
      console.error("gateway trickle PATCH failed", err);
    }
  }

  private attachRemote(stream: MediaStream, track: MediaStreamTrack): void {
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = stream;
    const sinkable = el as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (this.config.playbackDeviceId && sinkable.setSinkId) {
      sinkable.setSinkId(this.config.playbackDeviceId).catch(() => {});
    }
    // May reject without a user gesture; startAudioPlayback() retries.
    el.play().catch(() => {});
    this.audioEl = el;

    if (this.config.emitRawAudioSamples) {
      this.analyzer = createGatewayAnalyser(track);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A dropped connection (TypeError) or our own timeout abort.
function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    (err instanceof DOMException && err.name === "AbortError")
  );
}

// Exponential backoff clamped to the deadline; coming back online cuts it short.
function retryDelay(attempt: number, deadline: number): Promise<void> {
  const ms = Math.max(
    0,
    Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS, deadline - Date.now()),
  );
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}

// Falls back to iceConnectionState where connectionState is missing (Firefox < 113).
function isConnected(pc: RTCPeerConnection): boolean {
  if (pc.connectionState !== undefined)
    return pc.connectionState === "connected";
  return (
    pc.iceConnectionState === "connected" ||
    pc.iceConnectionState === "completed"
  );
}

function waitConnected(pc: RTCPeerConnection, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (isConnected(pc)) return resolve(true);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      pc.removeEventListener("connectionstatechange", onChange);
      pc.removeEventListener("iceconnectionstatechange", onChange);
      resolve(ok);
    };
    const onChange = () => {
      if (isConnected(pc)) done(true);
      else if (pc.signalingState === "closed") done(false);
    };
    const timer = setTimeout(() => done(false), Math.max(0, ms));
    pc.addEventListener("connectionstatechange", onChange);
    pc.addEventListener("iceconnectionstatechange", onChange);
  });
}

async function rollback(pc: RTCPeerConnection): Promise<void> {
  if (pc.signalingState !== "have-local-offer") return;
  await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
}

function createGatewayAnalyser(track: MediaStreamTrack): AnalyzerComponent {
  const Ctor: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctor();
  // Suspended contexts pull no samples. Playback is unaffected — that goes via
  // the <audio> element.
  ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  source.connect(analyser);

  const calculateVolume = (): number => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  };
  const cleanup = async (): Promise<void> => {
    try {
      source.disconnect();
    } catch {
      /* noop */
    }
    try {
      await ctx.close();
    } catch {
      /* noop */
    }
  };
  return { calculateVolume, analyser, cleanup };
}
