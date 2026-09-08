import { ControlApi } from "../control/api";
import { CreateWebCallRequest } from "../types";
import { AudioOptions, CallSession } from "./base-session";
import { SessionHooks } from "./events";

export interface WebCallOptions extends CreateWebCallRequest {
  hooks?: SessionHooks;
  // When the public key has reCAPTCHA enabled: a fresh v3 token for this call.
  recaptchaToken?: string;
  // Request fields this SDK version doesn't list yet; merged into the body.
  extra?: Record<string, unknown>;
  // Also stream the transcript. Needs Call.Write, which a public key scoped
  // to web calls alone won't have — off unless asked for.
  transcript?: boolean;
  audio?: AudioOptions;
}

// connecting → live → ended
export class WebCallSession extends CallSession {
  constructor(api: ControlApi, options: WebCallOptions) {
    super(api, options.hooks);
    if (options.transcript) this.nodeTransitionSource = "monitor";
    queueMicrotask(() => void this.start(options));
  }

  public mute(): void {
    this.transport?.setMicEnabled(false);
  }

  public unmute(): void {
    this.transport?.setMicEnabled(true);
  }

  // Leaving is what ends a web call; there is no one else to tell.
  public async end(): Promise<void> {
    this.disconnect();
  }

  private async start(options: WebCallOptions): Promise<void> {
    const { hooks, transcript, audio, recaptchaToken, extra, ...request } =
      options;
    try {
      let resp;
      try {
        resp = await this.api.createWebCall(
          { ...request, ...extra },
          { recaptchaToken },
        );
      } finally {
        this.reportVersion();
      }
      if (this.ended) return;
      this.callId = resp.call_id;
      await this.connectTransport({
        accessToken: resp.access_token,
        transport: resp.transport,
        callId: resp.call_id,
        url: resp.url,
        iceServers: resp.ice_servers,
        baseURL: this.api.host,
        ...audio,
      });
      this.setStatus("live");
      if (transcript) this.startMonitor(resp.call_id, false);
    } catch (err) {
      this.fail(err);
    }
  }
}
