import { EventEmitter } from "eventemitter3";
import { AnalyzerComponent, StartCallConfig, TransportKind } from "../transport";
/** @deprecated Use `RetellClientConfig` with `RetellClient`. */
export interface RetellClientOptions {
    defaultTransport?: TransportKind;
}
/**
 * @deprecated Use `RetellClient` — `createWebCall()` / `monitorCall()` handle
 * the API calls, transcript and take-over ordering for you. Removed in 4.0.
 */
export declare class RetellWebClient extends EventEmitter {
    private transport?;
    private connected;
    private defaultTransport;
    isAgentTalking: boolean;
    analyzerComponent: AnalyzerComponent;
    private captureAudioFrame?;
    constructor(options?: RetellClientOptions);
    startCall(startCallConfig: StartCallConfig): Promise<void>;
    startAudioPlayback(): Promise<void>;
    stopCall(): void;
    takeOver(): Promise<void>;
    mute(): void;
    unmute(): void;
    private captureAudioSamples;
    private handleServerEvent;
}
