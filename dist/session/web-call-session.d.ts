import { ControlApi } from "../control/api";
import { CreateWebCallRequest } from "../types";
import { AudioOptions, CallSession } from "./base-session";
import { SessionHooks } from "./events";
export interface WebCallOptions extends CreateWebCallRequest {
    hooks?: SessionHooks;
    recaptchaToken?: string;
    extra?: Record<string, unknown>;
    transcript?: boolean;
    audio?: AudioOptions;
}
export declare class WebCallSession extends CallSession {
    constructor(api: ControlApi, options: WebCallOptions);
    mute(): void;
    unmute(): void;
    end(): Promise<void>;
    private start;
}
