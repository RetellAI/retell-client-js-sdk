// What the API reports a call's media runs on. This SDK connects only to
// "gateway"; LiveKit calls need retell-client-js-sdk 3.x.
export type TransportKind = "livekit" | "gateway";

export interface StartCallConfig {
  // The API's `access_token`; it carries the room.
  accessToken: string;
  // The API's `transport`; anything but "gateway" is refused before connecting.
  transport?: TransportKind;

  // The API's `call_id`. Required for gateway calls: signaling is addressed by
  // call, and the room it resolves to is settled server side.
  callId?: string;
  // The API's `participant_id`. Defaults to the identity create-web-call mints
  // for, so only live-listen has to pass one.
  identity?: string;
  // Where signaling goes; defaults to https://api.retellai.com.
  baseURL?: string;
  // Must be set when the connection is created; they cannot be added later.
  // Omit for the SDK's public-STUN default — which live-listen depends on, since
  // without a mic grant Chrome only offers unroutable .local candidates.
  iceServers?: RTCIceServer[];

  // Join receive-only, publishing nothing until takeOver().
  listener?: boolean;

  // --- Common audio options ---
  sampleRate?: number;
  captureDeviceId?: string; // audio capture (mic) device id
  playbackDeviceId?: string; // audio playback (speaker) sink id
  // Emit Float32Array analyser snapshots for visualization. These are not
  // contiguous PCM frames. Defaults to false.
  emitRawAudioSamples?: boolean;
}

export interface AnalyzerComponent {
  calculateVolume: () => number;
  analyser: AnalyserNode;
  cleanup: () => Promise<void>;
}

export interface TransportHandlers {
  onConnected: () => void; // signaling established
  onCallReady: (analyzer: AnalyzerComponent | null) => void; // remote audio arrived
  onData: (event: any) => void; // control data-channel frame
  onDisconnected: () => void;
  onError: (message: string) => void;
}

export interface Transport {
  connect(handlers: TransportHandlers): Promise<void>;
  setMicEnabled(enabled: boolean): void;
  resumeAudioPlayback(): Promise<void>;
  close(): void;
  // The backend must have granted publish first; this opens the mic on the
  // connection already established by a listener join.
  takeOver(): Promise<void>;
}
