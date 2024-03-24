import { EventEmitter } from "eventemitter3";
export interface StartConversationConfig {
    callId: string;
    sampleRate: number;
    customStream?: MediaStream;
    enableUpdate?: boolean;
}
export declare class RetellWebClient extends EventEmitter {
    private liveClient;
    private audioContext;
    private isCalling;
    private stream;
    private audioNode;
    private customEndpoint;
    private captureNode;
    private audioData;
    private audioDataIndex;
    private isTalking;
    constructor(customEndpoint?: string);
    startConversation(startConversationConfig: StartConversationConfig): Promise<void>;
    stopConversation(): void;
    private handleAudioEvents;
    private setupAudioPlayback;
    private isAudioWorkletSupported;
    private playAudio;
}
