export interface MonitorSocketHandlers {
    onMessage: (msg: unknown) => void;
    onEnd: () => void;
    onError: (err: Error) => void;
}
export declare class MonitorSocket {
    private url;
    private protocols;
    private handlers;
    private ws?;
    private closed;
    private ended;
    private attempts;
    private notLiveAttempts;
    private emptyOpens;
    private timer?;
    constructor(url: string, protocols: string[], handlers: MonitorSocketHandlers);
    open(): void;
    close(): void;
    private reconnect;
    private fail;
}
