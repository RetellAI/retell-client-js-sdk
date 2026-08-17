import { StartCallConfig, Transport, TransportHandlers } from "./transport";
export declare class GatewayTransport implements Transport {
    private config;
    private base;
    private pc?;
    private dc?;
    private localStream?;
    private audioEl?;
    private analyzer?;
    private sessionId?;
    private pendingCandidates;
    private handlers?;
    private readyFired;
    constructor(config: StartCallConfig);
    connect(handlers: TransportHandlers): Promise<void>;
    private createSession;
    setMicEnabled(enabled: boolean): void;
    takeOver(): Promise<void>;
    private micConstraints;
    resumeAudioPlayback(): Promise<void>;
    close(): void;
    private identity;
    private headers;
    private sendCandidate;
    private attachRemote;
}
