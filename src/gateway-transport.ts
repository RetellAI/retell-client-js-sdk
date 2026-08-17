// Browser leg over the gateway's WHIP endpoints (POST/PATCH/DELETE
// /v1/webrtc/sessions). Audio only: the server→client event stream needs the
// gateway to relay orchestrator data onto the data channel, which it does not do
// yet — the channel and onData hook are wired so that stays a drop-in.

import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportHandlers,
} from "./transport";

// Retry window for the WHIP create while the room does not exist yet.
const JOIN_TIMEOUT_MS = 15000;
const JOIN_RETRY_MIN_MS = 150;
const JOIN_RETRY_MAX_MS = 1000;

// STUN only, and only needed by live-listen: that browser never opens its mic, so
// Chrome hides its addresses behind .local mDNS names that mean nothing outside
// its own network. Overridable via config.iceServers — TURN credentials are
// short-lived and per-call, so they cannot be baked in here.
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

    const pc = new RTCPeerConnection({
      iceServers: this.config.iceServers?.length
        ? this.config.iceServers
        : DEFAULT_ICE_SERVERS,
    });
    this.pc = pc;

    if (this.config.listener) {
      // Receive-only: asks for the room mix while offering no uplink.
      pc.addTransceiver("audio", { direction: "recvonly" });
    } else {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: this.micConstraints(),
      });
      this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    }

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

    // Before applying the answer: setRemoteDescription fires ontrack
    // synchronously, and call_started must precede call_ready as it does on
    // LiveKit.
    handlers.onConnected();

    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

    // Candidates gathered before we had a session id; later ones go direct.
    const flush = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of flush) this.sendCandidate(c);
  }

  // A gateway room is created by the agent's orchestrator, not on join, and
  // create-web-call returns as soon as the call is queued — so the browser
  // routinely arrives first and gets a 404. That is "not yet", not "no"; every
  // other status is terminal.
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

  // Local track toggle, as LiveKit's setMicrophoneEnabled does — distinct from
  // the server-side mute. No-op on a listener that has not taken over.
  public setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  // Opens the mic and renegotiates the existing PeerConnection. The backend must
  // have promoted the session first, or the gateway drops the uplink regardless.
  public async takeOver(): Promise<void> {
    if (!this.pc) throw new Error("gateway transport not connected");
    if (this.localStream) return; // already publishing (took over already)

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: this.micConstraints(),
    });
    const track = this.localStream.getAudioTracks()[0];

    // Flip the recvonly transceiver to sendrecv, keeping a single audio m-line.
    const audioTx = this.pc
      .getTransceivers()
      .find((t) => t.direction === "recvonly");
    if (audioTx) {
      await audioTx.sender.replaceTrack(track);
      audioTx.direction = "sendrecv";
    } else {
      this.pc.addTrack(track, this.localStream);
    }

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
      // Fire-and-forget so close() stays synchronous.
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
    // The backend returns the gateway token in the same `access_token` field
    // LiveKit used, so accept either name.
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

// AnalyzerComponent (livekit createAudioAnalyser shape) from a raw track.
function createGatewayAnalyser(track: MediaStreamTrack): AnalyzerComponent {
  const Ctor: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctor();
  // A fresh AudioContext starts suspended and pulls no samples until resumed.
  // Playback is unaffected either way — that goes via the <audio> element.
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
