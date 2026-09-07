import { AnyAuth, authHeaders, authSubprotocols } from "./auth";
import {
  CreateWebCallRequest,
  CreateWebCallResponse,
  ListenLiveCallResponse,
  UpdateLiveCallRequest,
} from "../types";
import { SDK_VERSION } from "../version";

// Same default the gateway transport signals through; both must agree, since
// the token minted here is spent there.
export const RETELL_API_HOST = "https://api.retellai.com";

const MIN_VERSION_HEADER = "X-Retell-Client-JS-SDK-Min-Version";
const RECOMMENDED_VERSION_HEADER = "X-Retell-Client-JS-SDK-Recommended-Version";

export interface ControlApiOptions {
  auth: AnyAuth;
  baseURL?: string;
  fetch?: typeof fetch;
}

export class RetellApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "RetellApiError";
  }
}

export interface VersionStatus {
  // "min": older than the backend still supports; "recommended": just behind.
  level: "min" | "recommended";
  current: string;
  min: string;
  recommended: string;
}

export function versionMessage(v: VersionStatus): string {
  return v.level === "min"
    ? `retell-client-js-sdk ${v.current} is below the minimum supported version ${v.min}; calls may fail. Upgrade to ${v.recommended}.`
    : `retell-client-js-sdk ${v.current} is behind the recommended version ${v.recommended}. Please upgrade.`;
}

export class ControlApi {
  public readonly host: string;
  public version?: VersionStatus;
  private auth: AnyAuth;
  private fetchImpl: typeof fetch;
  private versionChecked = false;

  constructor(options: ControlApiOptions) {
    this.auth = options.auth;
    this.host = (options.baseURL || RETELL_API_HOST).replace(/\/+$/, "");
    this.fetchImpl = options.fetch || fetch.bind(globalThis);
  }

  public createWebCall(
    body: CreateWebCallRequest,
  ): Promise<CreateWebCallResponse> {
    return this.request("POST", "/v3/create-web-call", body);
  }

  public listenLiveCall(callId: string): Promise<ListenLiveCallResponse> {
    return this.request("POST", `/v2/listen-live-call/${enc(callId)}`, {});
  }

  public async takeOverLiveCall(
    callId: string,
    participantId: string,
  ): Promise<void> {
    await this.request("POST", `/v2/take-over-live-call/${enc(callId)}`, {
      participant_id: participantId,
    });
  }

  public async updateLiveCall(
    callId: string,
    body: UpdateLiveCallRequest,
  ): Promise<void> {
    await this.request("PATCH", `/v2/update-live-call/${enc(callId)}`, body);
  }

  public async stopCall(callId: string): Promise<void> {
    await this.request("POST", `/v2/stop-call/${enc(callId)}`);
  }

  public monitorSocket(callId: string): { url: string; protocols: string[] } {
    return {
      url: `${this.host.replace(/^http/, "ws")}/v2/monitor-call/${enc(callId)}`,
      protocols: authSubprotocols(this.auth),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = authHeaders(this.auth);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const resp = await this.fetchImpl(this.host + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.checkVersion(resp);

    const text = await resp.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!resp.ok) {
      throw new RetellApiError(resp.status, errorMessage(data, resp), data);
    }
    return data as T;
  }

  // Once per client. Console only here; sessions surface "min" as `error`.
  private checkVersion(resp: Response): void {
    if (this.versionChecked) return;
    const min = resp.headers.get(MIN_VERSION_HEADER);
    if (!min) return;
    this.versionChecked = true;
    const recommended = resp.headers.get(RECOMMENDED_VERSION_HEADER) || min;
    let level: VersionStatus["level"] | undefined;
    if (compareVersions(SDK_VERSION, min) < 0) level = "min";
    else if (compareVersions(SDK_VERSION, recommended) < 0) level = "recommended";
    if (!level) return;
    this.version = { level, current: SDK_VERSION, min, recommended };
    console.error(
      "%c" + versionMessage(this.version),
      "font-weight:bold;font-size:1.2em",
    );
  }
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

function errorMessage(data: unknown, resp: Response): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const m = d.error_message ?? d.message ?? d.error;
    if (typeof m === "string") return m;
  }
  if (typeof data === "string" && data) return data;
  return `${resp.status} ${resp.statusText}`.trim();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
