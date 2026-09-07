import { ControlApi } from "../control/api";
import { CallEndedEvent } from "../types";
import { AudioOptions, CallSession } from "./base-session";
import { SessionHooks } from "./events";
export interface MonitorCallOptions {
    call_id: string;
    hooks?: SessionHooks;
    transcript?: boolean;
    audio?: AudioOptions;
}
export declare class MonitorSession extends CallSession {
    readonly callId: string;
    private audio?;
    private participantId?;
    private listening?;
    private takingOver?;
    private takeOverRequested;
    private pendingEnd?;
    protected nodeTransitionSource: "monitor";
    constructor(api: ControlApi, options: MonitorCallOptions);
    listen(): Promise<void>;
    takeOver(): Promise<void>;
    mute(): void;
    unmute(): void;
    end(): Promise<void>;
    protected onMonitorAttached(): void;
    protected monitorEnded(event: CallEndedEvent): void;
    private doListen;
    private doTakeOver;
}
