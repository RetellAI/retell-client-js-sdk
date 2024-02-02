import { AudioEncoding } from "retell-sdk/models/components/calldetail";
interface StartConversationConfig {
    agentId: string;
    sampleRate?: number;
    audioEncoding?: AudioEncoding;
    customStream?: MediaStream | null;
}
type EventListener = (data?: any) => void;
export declare class RetellClientSdk {
    private retell;
    private liveClient;
    private audioContext;
    private isCalling;
    private stream;
    private captureNode;
    private audioData;
    private audioDataIndex;
    private eventListeners;
    constructor(apiKey: string);
    startConversation({ agentId, sampleRate, audioEncoding, customStream }: StartConversationConfig): Promise<void>;
    stopConversation(): void;
    on(event: string, listener: EventListener): void;
    private setupAudio;
    private handleAudioEvents;
    private triggerEvent;
}
export {};
