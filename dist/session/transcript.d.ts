import { LiveCallUtterance } from "../types";
export declare class TranscriptStore {
    private items;
    private preSession;
    private seq;
    merge(transcripts: LiveCallUtterance[] | undefined, preSessionTranscripts: LiveCallUtterance[] | undefined): LiveCallUtterance[];
    get transcript(): LiveCallUtterance[];
    get preSessionTranscript(): LiveCallUtterance[];
    private mergeInto;
}
