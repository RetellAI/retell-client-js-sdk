// GatewayTransport: browser leg over the sip-webrtc-gateway WebRTC endpoint
// (WHIP-style signaling: POST/PATCH/DELETE /v1/webrtc/sessions). P1 is audio-only:
// mic up (Opus), agent audio down (the room mix), mute (local track), trickle ICE.
//
// The server→client event stream (update/metadata/agent_*_talking/node_transition)
// is NOT delivered yet — it needs the gateway to relay orchestrator data onto the
// WebRTC data channel. The data channel + onData hook are wired here so that phase
// is a drop-in; until then only audio flows.

import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportHandlers,
} from "./transport";

// How long to keep retrying the WHIP create while the room does not exist yet,
// and the backoff between attempts. The agent's orchestrator normally has the
// room up within a second; the ceiling is generous because the alternative is a
// call that fails for a reason the user cannot act on.
const JOIN_TIMEOUT_MS = 15000;
const JOIN_RETRY_MIN_MS = 150;
const JOIN_RETRY_MAX_MS = 1000;

// Default ICE servers, used when the backend does not supply its own.
//
// STUN only — one binding request/response, no media relayed. It exists for the
// live-listen case: that browser never opens its mic, so Chrome keeps its host
// addresses behind .local mDNS names, which are meaningless outside the browser's
// own network. STUN is what turns that into a real, reachable candidate.
//
// A public server is fine for this because the address is a constant, not a
// secret. TURN would be different: its credentials are short-lived and computed
// per call, which is why config.iceServers can override this — a deployment that
// needs relaying supplies its own list rather than shipping a new SDK.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export class GatewayTransport implements Transport {
  private config: StartCallConfig;
  private base: string;
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private localStream?: MediaStream;
  private audioEl?: HTMLAudioElement;
  private analyzer?: AnalyzerComponent;
  private sessionId?: string;
  private pendingCandidates: RTCIceCandidate[] = [];
  private handlers?: TransportHandlers;
  private readyFired = false;

  constructor(config: StartCallConfig) {
    this.config = config;
    this.base = (config.gatewayUrl || "").replace(/\/+$/, "");
  }

  public async connect(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers;
    if (!this.base || !this.config.callId) {
      throw new Error("gatewayUrl and callId are required for the gateway transport");
    }

    // Backend-supplied servers win; otherwise the STUN default above.
    const pc = new RTCPeerConnection({
      iceServers: this.config.iceServers?.length
        ? this.config.iceServers
        : DEFAULT_ICE_SERVERS,
    });
    this.pc = pc;

    if (this.config.listener) {
      // Live-listen: receive-only, no mic. A recvonly transceiver makes the offer
      // ask for the gateway's mix down-track while offering no uplink, so the
      // browser hears the room but publishes nothing until takeOver().
      pc.addTransceiver("audio", { direction: "recvonly" });
    } else {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: this.micConstraints(),
      });
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    }

    // Control channel: reserved for the gateway control protocol + (later) the
    // relayed server event stream. Wired now so enabling it is a drop-in.
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
      if (!this.sessionId) {
        this.pendingCandidates.push(ev.candidate);
        return;
      }
      this.sendCandidate(ev.candidate);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      // "disconnected" can be transient; only tear down on terminal states.
      if (s === "failed" || s === "closed") handlers.onDisconnected();
    };
    // Fallback for browsers without connectionState (Firefox < 113): map terminal
    // ICE states to teardown. onDisconnected → stopCall is idempotent, so running
    // alongside onconnectionstatechange on modern browsers is harmless.
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed" || s === "closed") handlers.onDisconnected();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answer = await this.createSession(pc.localDescription!.sdp);
    this.sessionId = answer.session_id;

    // Signaling is established here — fire onConnected (call_started) BEFORE
    // applying the answer, since setRemoteDescription synchronously fires ontrack
    // (call_ready). This preserves the LiveKit ordering: call_started → call_ready.
    handlers.onConnected();

    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

    // Flush candidates gathered before we had the session id; later ones go direct.
    const flush = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of flush) this.sendCandidate(c);
  }

  // createSession POSTs the offer to the WHIP endpoint, retrying while the room
  // does not exist yet.
  //
  // Unlike LiveKit, a gateway room is not created on join — the agent's
  // orchestrator creates it, and the browser leg is deliberately not allowed to,
  // so that a request landing on the wrong instance fails instead of opening an
  // empty room there. create-web-call returns as soon as the call is queued, so
  // the browser can easily arrive first and get a 404. That is a "not yet", not a
  // "no": retry it. Every other status is terminal.
  private async createSession(
    sdp: string,
  ): Promise<{ session_id: string; sdp: string }> {
    const deadline = Date.now() + JOIN_TIMEOUT_MS;
    let delay = JOIN_RETRY_MIN_MS;
    for (;;) {
      const resp = await fetch(this.base + "/v1/webrtc/sessions", {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          call_id: this.config.callId,
          identity: this.identity(),
          target: this.config.target || undefined,
          direction: this.config.direction || undefined,
          sdp,
        }),
      });
      if (resp.ok) return await resp.json();

      const body = await resp.text();
      if (resp.status !== 404 || Date.now() >= deadline) {
        throw new Error(`gateway WHIP POST failed: ${resp.status} ${body}`);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, JOIN_RETRY_MAX_MS);
    }
  }

  public setMicEnabled(enabled: boolean): void {
    // Local track toggle (parity with LiveKit's setMicrophoneEnabled): stops
    // sending the mic, distinct from the server-side "drop content" mute. No-op on
    // a receive-only listener that hasn't taken over yet (no local track).
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  // takeOver upgrades a receive-only live-listen session into a talking one: it
  // opens the mic now (the take-over user gesture) and renegotiates so the uplink
  // is added to the existing PeerConnection. The backend must have promoted the
  // session first (POST /v2/take-over-live-call) — otherwise the gateway drops the
  // uplink audio even after this renegotiation. Idempotent-ish: a second call with
  // the mic already open is a no-op.
  public async takeOver(): Promise<void> {
    if (!this.pc) throw new Error("gateway transport not connected");
    if (this.localStream) return; // already publishing (took over already)

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: this.micConstraints(),
    });
    const track = this.localStream.getAudioTracks()[0];

    // Reuse the recvonly transceiver from connect() (flip to sendrecv) so we keep a
    // single audio m-line; fall back to addTrack if it isn't there.
    const audioTx = this.pc
      .getTransceivers()
      .find((t) => t.direction === "recvonly");
    if (audioTx) {
      await audioTx.sender.replaceTrack(track);
      audioTx.direction = "sendrecv";
    } else {
      this.pc.addTrack(track, this.localStream);
    }

    // Renegotiate over the WHIP resource: application/sdp offer → SDP answer.
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const resp = await fetch(
      `${this.base}/v1/webrtc/sessions/${this.sessionId}`,
      {
        method: "PATCH",
        headers: this.headers({ "Content-Type": "application/sdp" }),
        body: this.pc.localDescription!.sdp,
      },
    );
    if (!resp.ok) {
      throw new Error(
        `gateway take-over renegotiation failed: ${resp.status} ${await resp.text()}`,
      );
    }
    await this.pc.setRemoteDescription({
      type: "answer",
      sdp: await resp.text(),
    });
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
    if (this.sessionId) {
      // Best-effort hangup; fire-and-forget so close() stays synchronous.
      fetch(`${this.base}/v1/webrtc/sessions/${this.sessionId}`, {
        method: "DELETE",
        headers: this.headers(),
      }).catch(() => {});
    }
    try {
      this.dc?.close();
    } catch {
      /* noop */
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
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

  private identity(): string {
    return this.config.identity || `web-${this.config.callId}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...(extra || {}) };
    // On a gateway call the backend returns its browser token in the same
    // `access_token` field LiveKit used, so accept either name and let callers
    // pass the response through unchanged.
    const token = this.config.callToken || this.config.accessToken;
    if (token) h["Authorization"] = "Bearer " + token;
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

// createGatewayAnalyser builds an AnalyzerComponent (livekit createAudioAnalyser
// shape) from a raw MediaStreamTrack using the Web Audio API.
function createGatewayAnalyser(track: MediaStreamTrack): AnalyzerComponent {
  const Ctor: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctor();
  // A freshly created AudioContext starts "suspended" and won't pull samples until
  // resumed (needs a user gesture in some browsers). Best-effort resume so the
  // analyser produces data; playback is unaffected (it goes via the <audio> element).
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
