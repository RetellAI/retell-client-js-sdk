// A call runs on exactly one transport, chosen once at startCall — no mid-call
// switching. Both feed the same handlers, so the public events are identical.

export type TransportKind = "livekit" | "gateway";

export interface StartCallConfig {
  // The API's `access_token`, whichever transport issued it. Both transports
  // carry the room in the token, so neither needs to be told a room name.
  accessToken?: string;
  // The API's `transport`. Say it rather than letting the SDK guess: the two
  // tokens are indistinguishable, and guessing wrong means handing a gateway
  // token to LiveKit.
  transport?: TransportKind;

  // --- Gateway (WHIP) ---
  // The API's `call_id`. Required for gateway calls: signaling is addressed by
  // call, and the room it resolves to is settled server side.
  callId?: string;
  // The API's `participant_id`. Defaults to the identity create-web-call mints
  // for, so only live-listen has to pass one.
  identity?: string;
  // Overrides the Retell host signaling is sent to. For local development only —
  // production needs no address, the same way the LiveKit transport needs none.
  apiHost?: string;
  // Must be set when the connection is created; they cannot be added later.
  // Omit for the SDK's public-STUN default — which live-listen depends on, since
  // without a mic grant Chrome only offers unroutable .local candidates.
  iceServers?: RTCIceServer[];

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

// Mirrors livekit-client's createAudioAnalyser shape.
export interface AnalyzerComponent {
  calculateVolume: () => number;
  analyser: AnalyserNode;
  cleanup: () => Promise<void>;
}

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
  // Gateway only; the backend must have promoted the session first.
  takeOver?(): Promise<void>;
}

// The API's `transport` decides — nothing else can. Both transports deliver their
// token in `accessToken`, and neither is handed an address to give it away.
export function selectTransport(
  config: StartCallConfig,
  fallback: TransportKind,
): TransportKind {
  return config.transport ?? fallback;
}
