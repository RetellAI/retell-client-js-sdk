import { MonitorCallOptions, MonitorSession } from "./session/monitor-session";
import { WebCallOptions, WebCallSession } from "./session/web-call-session";
import { RetellAuth, UpdateLiveCallRequest } from "./types";
export type RetellClientConfig = RetellAuth & {
    baseURL?: string;
    fetch?: typeof fetch;
};
export declare class RetellClient {
    private api;
    constructor(config: RetellClientConfig);
    createWebCall(options: WebCallOptions): WebCallSession;
    monitorCall(options: MonitorCallOptions): MonitorSession;
    stopCall(callId: string): Promise<void>;
    updateLiveCall(callId: string, body: UpdateLiveCallRequest): Promise<void>;
}
