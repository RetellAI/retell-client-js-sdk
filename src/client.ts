import { ControlApi } from "./control/api";
import { MonitorCallOptions, MonitorSession } from "./session/monitor-session";
import { WebCallOptions, WebCallSession } from "./session/web-call-session";
import { RetellAuth, UpdateLiveCallRequest } from "./types";

export type RetellClientConfig = RetellAuth & {
  // Defaults to https://api.retellai.com; override for another region or a
  // proxy. Applies to REST, the monitor WebSocket, and call signaling.
  baseURL?: string;
  // Route control calls through your own backend instead of shipping a key.
  fetch?: typeof fetch;
};

// Holds the credential; each call is a session. Any number may run at once.
export class RetellClient {
  private api: ControlApi;

  constructor(config: RetellClientConfig) {
    this.api = new ControlApi({
      auth: config,
      baseURL: config.baseURL,
      fetch: config.fetch,
    });
  }

  // Start a call with an agent and join it. Returns at once; progress comes
  // through hooks / events.
  public createWebCall(options: WebCallOptions): WebCallSession {
    return new WebCallSession(this.api, options);
  }

  // Watch an ongoing call: transcript now, audio on listen(), mic on takeOver().
  public monitorCall(options: MonitorCallOptions): MonitorSession {
    return new MonitorSession(this.api, options);
  }

  // Control without a session, e.g. from a server.
  public stopCall(callId: string): Promise<void> {
    return this.api.stopCall(callId);
  }

  public updateLiveCall(
    callId: string,
    body: UpdateLiveCallRequest,
  ): Promise<void> {
    return this.api.updateLiveCall(callId, body);
  }
}
