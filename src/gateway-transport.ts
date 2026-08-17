import {
  AnalyzerComponent,
  StartCallConfig,
  Transport,
  TransportHandlers,
} from "./transport";

const JOIN_TIMEOUT_MS = 15000;
const JOIN_RETRY_MIN_MS = 150;
const JOIN_RETRY_MAX_MS = 1000;

// Live-listen needs this: with no mic grant Chrome offers only .local mDNS
// candidates, unroutable outside its own network.
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
    // For browsers without connectionState (Firefox < 113). Harmless alongside
    // the above: onDisconnected is idempotent.
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed" || s === "closed") handlers.onDisconnected();
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answer = await this.createSession(pc.localDescription!.sdp);
    this.sessionId = answer.session_id;

    // Before the answer: setRemoteDescription fires ontrack synchronously, and
    // call_started must precede call_ready.
    handlers.onConnected();

    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });

    const flush = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of flush) this.sendCandidate(c);
  }

  // The room is created by the orchestrator, not on join, so a 404 here means
  // "not yet" and is retried. Every other status is terminal.
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

  // Local track toggle, distinct from the server-side mute.
  public setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  // The backend must have promoted the session first, or the gateway drops the
  // uplink regardless.
  public async takeOver(): Promise<void> {
    if (!this.pc) throw new Error("gateway transport not connected");
    if (this.localStream) return; // already publishing (took over already)

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: this.micConstraints(),
    });
    const track = this.localStream.getAudioTracks()[0];

    // Reuse the existing transceiver to keep a single audio m-line.
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
    // The backend returns the gateway token in LiveKit's `access_token` field.
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
