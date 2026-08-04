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

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.config.captureDeviceId,
        sampleRate: this.config.sampleRate,
        channelCount: 1,
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // ICE servers (coturn etc.) come from the backend bootstrap; empty ⇒ direct
    // to the gateway's public host candidate.
    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers || [] });
    this.pc = pc;
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

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

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const resp = await fetch(this.base + "/v1/webrtc/sessions", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        call_id: this.config.callId,
        identity: this.identity(),
        target: this.config.target || undefined,
        sdp: pc.localDescription!.sdp,
      }),
    });
    if (!resp.ok) {
      throw new Error(
        `gateway WHIP POST failed: ${resp.status} ${await resp.text()}`,
      );
    }
    const answer = await resp.json();
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

  public setMicEnabled(enabled: boolean): void {
    // Local track toggle (parity with LiveKit's setMicrophoneEnabled): stops
    // sending the mic, distinct from the server-side "drop content" mute.
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
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
    if (this.config.callToken) h["Authorization"] = "Bearer " + this.config.callToken;
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
