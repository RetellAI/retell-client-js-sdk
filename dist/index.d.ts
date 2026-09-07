import { EventEmitter } from "eventemitter3";
import { AnalyzerComponent, StartCallConfig, TransportKind } from "./transport";
export { StartCallConfig, TransportKind, AnalyzerComponent, } from "./transport";
export interface RetellClientOptions {
    defaultTransport?: TransportKind;
}
export declare class RetellWebClient extends EventEmitter {
    private transport?;
    private connected;
    private defaultTransport;
    isAgentTalking: boolean;
    analyzerComponent?: AnalyzerComponent;
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
