import { EventEmitter } from "eventemitter3";
export interface StartConversationConfig {
    callId: string;
    sampleRate?: number;
    customStream?: MediaStream;
    enableUpdate?: boolean;
}
export declare class RetellWebClient extends EventEmitter {
    private liveClient;
    private audioContext;
    private isCalling;
    private stream;
    private audioNode;
    constructor();
    startConversation(startConversationConfig: StartConversationConfig): Promise<void>;
    stopConversation(): void;
    private setupAudio;
    private handleAudioEvents;
}
