// Wire types shared by the control path (REST + monitor WS). Field names are
// the API's own, so a request body can be copied from the docs unchanged.

import { TransportKind } from "./transport";

// A public key. The backend checks the page's Origin against the key's
// allowed domains, so scope the key to what the page needs.
export interface RetellAuth {
  key: string;
}

// --- /v3/create-web-call ---

export interface CreateWebCallRequest {
  agent_id: string;
  agent_version?: number;
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
  tool_mocks?: unknown;
  agent_override?: unknown;
  current_node_id?: string;
  current_state?: string;
}

export interface CreateWebCallResponse {
  call_id: string;
  access_token: string;
  // Missing on older backends, which are LiveKit-only.
  transport?: TransportKind;
  url?: string;
  ice_servers?: RTCIceServer[];
  expires_at?: number;
}

// --- /v2/listen-live-call ---

export interface ListenLiveCallResponse {
  transport?: TransportKind;
  access_token: string;
  url?: string;
  room_name: string;
  // The identity to hand back to take-over.
  participant_id: string;
  ice_servers?: RTCIceServer[];
  gateway_ip?: string;
  expires_at: number;
}

// --- /v2/update-live-call ---

export type DataStorageSetting =
  | "everything"
  | "everything_except_pii"
  | "basic_attributes_only";

export interface UpdateLiveCallRequest {
  fields_to_override?: {
    override_dynamic_variables?: Record<string, string> | null;
    metadata?: Record<string, unknown>;
    data_storage_setting?: DataStorageSetting;
  };
  call_control?: {
    trigger_response?: boolean;
    additional_context?: string;
  };
}

// --- Transcript items (monitor WS) ---

export interface Utterance {
  role: "agent" | "user" | "transfer_target";
  content: string;
  metadata?: {
    is_backchannel?: boolean;
    response_id?: number;
    interrupt_id?: number;
  };
}

export interface ToolCallInvocationUtterance {
  role: "tool_call_invocation";
  tool_call_id: string;
  name: string;
  arguments: string;
  is_state_transition?: boolean;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallResultUtterance {
  role: "tool_call_result";
  tool_call_id: string;
  content: string;
  successful: boolean;
}

export interface NodeTransitionUtterance {
  role: "node_transition";
  former_node_id: string;
  former_node_name: string;
  new_node_id: string;
  new_node_name: string;
  transition_type?: string;
  global_transition?: boolean;
}

export interface DtmfUtterance {
  role: "dtmf";
  digit: string;
}

export interface SmsUtterance {
  role: "sms";
  content: string;
  multimedia?: { url: string; summary?: string }[];
}

export interface InjectedUtterance {
  role: "injected";
  content: string;
}

// Each item carries a stable id; snapshots and deltas are merged by it.
export type LiveCallUtterance = (
  | Utterance
  | ToolCallInvocationUtterance
  | ToolCallResultUtterance
  | NodeTransitionUtterance
  | DtmfUtterance
  | SmsUtterance
  | InjectedUtterance
) & { id: string; time_sec: number };

export type DisconnectionReason =
  | "user_hangup"
  | "agent_hangup"
  | "call_transfer"
  | "voicemail_reached"
  | "ivr_reached"
  | "inactivity"
  | "max_duration_reached"
  | "concurrency_limit_reached"
  | "no_valid_payment"
  | "scam_detected"
  | "dial_busy"
  | "dial_failed"
  | "dial_no_answer"
  | "invalid_destination"
  | "telephony_provider_permission_denied"
  | "telephony_provider_unavailable"
  | "sip_routing_error"
  | "marked_as_spam"
  | "user_declined"
  | "error_llm_websocket_open"
  | "error_llm_websocket_lost_connection"
  | "error_llm_websocket_runtime"
  | "error_llm_websocket_corrupt_payload"
  | "error_no_audio_received"
  | "error_asr"
  | "error_retell"
  | "error_unknown"
  | "error_user_not_joined"
  | "registered_call_timeout"
  | "transfer_bridged"
  | "transfer_cancelled"
  | "manual_stopped"
  | "call_take_over";

export type LiveCallNodeTransition = NodeTransitionUtterance & {
  id: string;
  time_sec: number;
};

export interface CallEndedEvent {
  event_timestamp?: number;
  disconnection_reason?: DisconnectionReason;
}

// --- Data-channel events (LiveKit "server" participant / gateway control) ---

export interface UpdateEvent {
  event_type: "update";
  transcript: Utterance[];
  turntaking?: "agent_turn" | "user_turn";
  [field: string]: unknown;
}

export interface MetadataEvent {
  event_type: "metadata";
  metadata: unknown;
  [field: string]: unknown;
}

export interface NodeTransitionEvent {
  event_type: "node_transition";
  [field: string]: unknown;
}
