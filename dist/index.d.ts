interface StartConversationConfig {
    callId: string;
    sampleRate?: number;
    customStream?: MediaStream | null;
}
type EventListener = (data?: any) => void;
export declare class RetellClientSdk {
    private liveClient;
    private audioContext;
    private isCalling;
    private stream;
    private captureNode;
    private audioData;
    private audioDataIndex;
    private eventListeners;
    constructor();
    startConversation({ callId, sampleRate, customStream }: StartConversationConfig): Promise<void>;
    stopConversation(): void;
    on(event: string, listener: EventListener): void;
    private setupAudio;
    private handleAudioEvents;
    private triggerEvent;
}
export {};
