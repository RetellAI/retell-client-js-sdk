import { AnyAuth } from "./auth";
import { CreateWebCallRequest, CreateWebCallResponse, ListenLiveCallResponse, UpdateLiveCallRequest } from "../types";
export declare const RETELL_API_HOST = "https://api.retellai.com";
export interface RequestOptions {
    recaptchaToken?: string;
    extra?: Record<string, unknown>;
}
export interface ControlApiOptions {
    auth: AnyAuth;
    baseURL?: string;
    fetch?: typeof fetch;
}
export declare class RetellApiError extends Error {
    readonly status: number;
    readonly body?: unknown;
    constructor(status: number, message: string, body?: unknown);
}
export interface VersionStatus {
    level: "min" | "recommended";
    current: string;
    min: string;
    recommended: string;
}
export declare function versionMessage(v: VersionStatus): string;
export declare class ControlApi {
    readonly host: string;
    version?: VersionStatus;
    private auth;
    private fetchImpl;
    private versionChecked;
    constructor(options: ControlApiOptions);
    createWebCall(body: CreateWebCallRequest, opts?: RequestOptions): Promise<CreateWebCallResponse>;
    listenLiveCall(callId: string, opts?: RequestOptions): Promise<ListenLiveCallResponse>;
    takeOverLiveCall(callId: string, participantId: string, opts?: RequestOptions): Promise<void>;
    updateLiveCall(callId: string, body: UpdateLiveCallRequest, opts?: RequestOptions): Promise<void>;
    stopCall(callId: string, opts?: RequestOptions): Promise<void>;
    monitorSocket(callId: string): {
        url: string;
        protocols: string[];
    };
    private request;
    private checkVersion;
}
