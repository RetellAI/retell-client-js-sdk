// A call runs on exactly one transport, chosen once at startCall. Both feed the
// same handlers, so the public RetellWebClient events are identical either way.

export type TransportKind = "livekit" | "gateway";

export interface StartCallConfig {
  // --- LiveKit ---
  accessToken?: string; // room-scoped JWT

  // --- Gateway (WHIP) ---
  gatewayUrl?: string; // gateway base URL
  callId?: string; // locates the room the browser joins
  callToken?: string; // per-call JWT, sent as Bearer (accessToken also accepted)
  identity?: string; // must match the token's identity claim
  target?: string; // room target, default "main"
  direction?: "inbound" | "outbound"; // must match the agent leg
  // Must be set when the connection is created; they cannot be added later.
  // Omit for the SDK's public-STUN default — which live-listen depends on, since
  // without a mic grant Chrome only offers unroutable .local candidates.
  iceServers?: RTCIceServer[];

  // Explicit transport wins; otherwise inferred from which fields are present,
  // then the client's defaultTransport.
  transport?: TransportKind;

  // Gateway only: join receive-only, publishing nothing until takeOver().
  listener?: boolean;

  // --- Common audio options ---
  sampleRate?: number;
  captureDeviceId?: string; // audio capture (mic) device id
  playbackDeviceId?: string; // audio playback (speaker) sink id
  // Emit Float32Array analyser snapshots for visualization. These are not
  // contiguous PCM frames. Defaults to false.
  emitRawAudioSamples?: boolean;
}

// Mirrors livekit-client's createAudioAnalyser shape, so the client's raw-sample
// loop is transport-agnostic.
export interface AnalyzerComponent {
  calculateVolume: () => number;
  analyser: AnalyserNode;
  cleanup: () => Promise<void>;
}

// Wired by RetellWebClient before connect(); it turns these into public events.
export interface TransportHandlers {
  onConnected: () => void; // signaling established → call_started
  onCallReady: (analyzer: AnalyzerComponent | null) => void; // → call_ready
  onData: (event: any) => void; // server data event (LiveKit only, so far)
  onDisconnected: () => void; // → stopCall / call_ended
  onError: (message: string) => void; // → error
}

export interface Transport {
  connect(handlers: TransportHandlers): Promise<void>;
  setMicEnabled(enabled: boolean): void;
  resumeAudioPlayback(): Promise<void>;
  close(): void;
  // Gateway only: open the mic on a receive-only session and renegotiate. The
  // backend must have promoted the session first.
  takeOver?(): Promise<void>;
}

export function selectTransport(
  config: StartCallConfig,
  fallback: TransportKind,
): TransportKind {
  if (config.transport) return config.transport;
  if (config.gatewayUrl || config.callToken) return "gateway";
  if (config.accessToken) return "livekit";
  return fallback;
}
