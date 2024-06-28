import { EventEmitter } from "eventemitter3";
export interface StartCallConfig {
    accessToken: string;
    sampleRate?: number;
    captureDeviceId?: string;
    playbackDeviceId?: string;
    emitRawAudioSamples?: boolean;
}
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}
export declare class RetellWebClient extends EventEmitter {
    private room;
    private connected;
    audioContext: AudioContext;
    sampleRate: number;
    isAgentTalking: boolean;
    private audioAnalyzerNode;
    private captureAudioFrame;
    constructor();
    private getNewAudioContext;
    startCall(startCallConfig: StartCallConfig): Promise<void>;
    startAudioPlayback(): Promise<void>;
    stopCall(): void;
    mute(): void;
    unmute(): void;
    private captureAudioSamples;
    private handleRoomEvents;
    private handleAudioEvents;
    private handleDataEvents;
}
