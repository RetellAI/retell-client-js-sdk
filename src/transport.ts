// Transport abstraction: a call runs on exactly ONE transport (LiveKit or the
// gateway), chosen once at startCall. There is no mid-call switching and no
// per-call bridging — the two transports simply coexist in the SDK and are
// selected per call. Both feed the same high-level handlers, so the public
// RetellWebClient events stay identical regardless of transport.

export type TransportKind = "livekit" | "gateway";

export interface StartCallConfig {
  // --- LiveKit transport ---
  accessToken?: string; // LiveKit access token (room-scoped JWT)

  // --- Gateway (WHIP) transport ---
  gatewayUrl?: string; // gateway base URL, e.g. "https://gw.example.com"
  callId?: string; // locates the room the browser joins
  callToken?: string; // per-call short-lived JWT, sent as Bearer to the WHIP endpoint
  identity?: string; // participant identity; defaults to "web-<callId>"
  target?: string; // room target, default "main"

  // --- Transport selection (backend-authoritative, caller-overridable) ---
  // Explicit `transport` wins; otherwise inferred from which fields are present
  // (gateway if gateway fields, else livekit), then the client's defaultTransport.
  transport?: TransportKind;

  // --- Common audio options ---
  sampleRate?: number;
  captureDeviceId?: string; // audio capture (mic) device id
  playbackDeviceId?: string; // audio playback (speaker) sink id
  emitRawAudioSamples?: boolean; // receive raw float32 agent-audio samples (viz). Default false.
}

// AnalyzerComponent mirrors livekit-client's createAudioAnalyser return shape, so
// the RetellWebClient's raw-sample loop is transport-agnostic.
export interface AnalyzerComponent {
  calculateVolume: () => number;
  analyser: AnalyserNode;
  cleanup: () => Promise<void>;
}

// TransportHandlers are wired by RetellWebClient before connect(); a transport
// invokes them and the client turns them into public EventEmitter events.
export interface TransportHandlers {
  onConnected: () => void; // signaling/session established → call_started
  onCallReady: (analyzer: AnalyzerComponent | null) => void; // agent audio flowing → call_ready
  onData: (event: any) => void; // server data event (LiveKit today; gateway in a later phase)
  onDisconnected: () => void; // transport dropped → stopCall / call_ended
  onError: (message: string) => void; // → error
}

export interface Transport {
  connect(handlers: TransportHandlers): Promise<void>;
  setMicEnabled(enabled: boolean): void;
  resumeAudioPlayback(): Promise<void>;
  close(): void;
}

// selectTransport resolves the transport for a call. Explicit config wins, then
// inference from present fields, then the client-level fallback.
export function selectTransport(
  config: StartCallConfig,
  fallback: TransportKind,
): TransportKind {
  if (config.transport) return config.transport;
  if (config.gatewayUrl || config.callToken) return "gateway";
  if (config.accessToken) return "livekit";
  return fallback;
}
