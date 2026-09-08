import { StartCallConfig, Transport, TransportHandlers } from "./transport";
export declare class LiveKitTransport implements Transport {
    private room?;
    private config;
    private micTrack?;
    private readyFired;
    constructor(config: StartCallConfig);
    connect(handlers: TransportHandlers): Promise<void>;
    takeOver(): Promise<void>;
    private waitForPublishGrant;
    setMicEnabled(enabled: boolean): void;
    resumeAudioPlayback(): Promise<void>;
    close(): void;
}
