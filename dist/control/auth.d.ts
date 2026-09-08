import { RetellAuth } from "../types";
export interface AnyAuth extends RetellAuth {
    orgId?: string;
    orgUserId?: string;
}
export declare function authHeaders(auth: AnyAuth): Record<string, string>;
export declare function authSubprotocols(auth: AnyAuth): string[];
