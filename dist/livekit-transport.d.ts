import { StartCallConfig, Transport, TransportHandlers } from "./transport";
export declare class LiveKitTransport implements Transport {
    private room?;
    private config;
    constructor(config: StartCallConfig);
    connect(handlers: TransportHandlers): Promise<void>;
    setMicEnabled(enabled: boolean): void;
    resumeAudioPlayback(): Promise<void>;
    close(): void;
}
