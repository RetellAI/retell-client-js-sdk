import { CallEndedEvent, LiveCallNodeTransition, LiveCallUtterance, MetadataEvent, NodeTransitionEvent, UpdateEvent } from "../types";
export type SessionStatus = "connecting" | "live" | "monitoring" | "listening" | "taken_over" | "ended";
export interface SessionEventMap {
    status: [status: SessionStatus];
    transcript: [
        transcript: LiveCallUtterance[],
        preSessionTranscript: LiveCallUtterance[]
    ];
    agent_start_talking: [];
    agent_stop_talking: [];
    update: [event: UpdateEvent];
    metadata: [event: MetadataEvent];
    node_transition: [event: NodeTransitionEvent | LiveCallNodeTransition];
    audio: [samples: Float32Array];
    end: [event: CallEndedEvent];
    error: [error: Error];
}
export type SessionEvent = keyof SessionEventMap;
export interface SessionHooks {
    onStatus?: (status: SessionStatus) => void;
    onTranscript?: (transcript: LiveCallUtterance[], preSessionTranscript: LiveCallUtterance[]) => void;
    onAgentStartTalking?: () => void;
    onAgentStopTalking?: () => void;
    onUpdate?: (event: UpdateEvent) => void;
    onMetadata?: (event: MetadataEvent) => void;
    onNodeTransition?: (event: NodeTransitionEvent | LiveCallNodeTransition) => void;
    onAudio?: (samples: Float32Array) => void;
    onEnd?: (event: CallEndedEvent) => void;
    onError?: (error: Error) => void;
}
export declare const HOOK_EVENTS: {
    [K in keyof Required<SessionHooks>]: SessionEvent;
};
export declare const DATA_CHANNEL_EVENTS: Record<string, Extract<SessionEvent, "update" | "metadata" | "agent_start_talking" | "agent_stop_talking" | "node_transition">>;
export declare const MONITOR_EVENTS: Record<string, Extract<SessionEvent, "transcript" | "end">>;
