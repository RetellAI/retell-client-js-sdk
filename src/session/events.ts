// The one list of events a session emits. Types and the runtime whitelist both
// derive from it: a server frame whose name isn't mapped here is dropped, so a
// newer backend can't push this SDK version an event it never declared.

import {
  CallEndedEvent,
  LiveCallNodeTransition,
  LiveCallUtterance,
  MetadataEvent,
  NodeTransitionEvent,
  UpdateEvent,
} from "../types";

export type SessionStatus =
  | "connecting"
  | "live" // web call: talking to the agent
  | "monitoring" // transcript only
  | "listening" // + live audio
  | "taken_over" // + our mic, the AI is gone
  | "ended";

export interface SessionEventMap {
  status: [status: SessionStatus];
  transcript: [
    transcript: LiveCallUtterance[],
    preSessionTranscript: LiveCallUtterance[],
  ];
  agent_start_talking: [];
  agent_stop_talking: [];
  update: [event: UpdateEvent];
  metadata: [event: MetadataEvent];
  // From the data channel on a web call, from the transcript stream on a
  // monitored one (once per item, on first sight).
  node_transition: [event: NodeTransitionEvent | LiveCallNodeTransition];
  // Needs audio.emitRawAudioSamples.
  audio: [samples: Float32Array];
  end: [event: CallEndedEvent];
  error: [error: Error];
}

export type SessionEvent = keyof SessionEventMap;

export interface SessionHooks {
  onStatus?: (status: SessionStatus) => void;
  onTranscript?: (
    transcript: LiveCallUtterance[],
    preSessionTranscript: LiveCallUtterance[],
  ) => void;
  onAgentStartTalking?: () => void;
  onAgentStopTalking?: () => void;
  onUpdate?: (event: UpdateEvent) => void;
  onMetadata?: (event: MetadataEvent) => void;
  onNodeTransition?: (
    event: NodeTransitionEvent | LiveCallNodeTransition,
  ) => void;
  onAudio?: (samples: Float32Array) => void;
  onEnd?: (event: CallEndedEvent) => void;
  onError?: (error: Error) => void;
}

// Hooks are just listeners bound at construction.
export const HOOK_EVENTS: { [K in keyof Required<SessionHooks>]: SessionEvent } =
  {
    onStatus: "status",
    onTranscript: "transcript",
    onAgentStartTalking: "agent_start_talking",
    onAgentStopTalking: "agent_stop_talking",
    onUpdate: "update",
    onMetadata: "metadata",
    onNodeTransition: "node_transition",
    onAudio: "audio",
    onEnd: "end",
    onError: "error",
  };

// Data channel: `event_type` → session event.
export const DATA_CHANNEL_EVENTS: Record<
  string,
  Extract<
    SessionEvent,
    | "update"
    | "metadata"
    | "agent_start_talking"
    | "agent_stop_talking"
    | "node_transition"
  >
> = {
  update: "update",
  metadata: "metadata",
  agent_start_talking: "agent_start_talking",
  agent_stop_talking: "agent_stop_talking",
  node_transition: "node_transition",
};

// Monitor WS: `type` → session event.
export const MONITOR_EVENTS: Record<
  string,
  Extract<SessionEvent, "transcript" | "end">
> = {
  transcript_snapshot: "transcript",
  transcript_updated: "transcript",
  call_ended: "end",
};
