// The /v2/monitor-call stream. Owns reconnection; the session owns meaning.
//
// Close codes: 4xxx are app-level rejections (auth, PII gate, max watchers)
// and terminal — except 4004 "not live", which just means the call hasn't
// flipped ONGOING yet and is retried quietly. Anything below 4000 is transport
// trouble and retried with backoff.

const WS_CLOSE_NOT_LIVE = 4004;
const WS_CLOSE_NORMAL = 1000;
const MAX_ATTEMPTS = 8;

// 0.5s → 15s with jitter, so a backend restart doesn't sync every client.
function backoffMs(attempt: number): number {
  return Math.min(15_000, 500 * 2 ** attempt) + Math.random() * 250;
}

export interface MonitorSocketHandlers {
  onMessage: (msg: unknown) => void;
  // The server closed the stream because the call ended, without (or after)
  // a call_ended message.
  onEnd: () => void;
  // Terminal: no further reconnects.
  onError: (err: Error) => void;
}

export class MonitorSocket {
  private ws?: WebSocket;
  private closed = false;
  private ended = false;
  // Both count consecutive failures and reset once the server has admitted
  // us (first frame), not on open: a server that accepts and drops us every
  // time must back off like any other failure, and not be retried forever.
  private attempts = 0;
  private notLiveAttempts = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private url: string,
    private protocols: string[],
    private handlers: MonitorSocketHandlers,
  ) {}

  public open(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, this.protocols);
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    }
    this.ws = ws;

    ws.onmessage = (ev) => {
      if (this.closed || ws !== this.ws) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      // Admitted — earlier retries don't count against a later drop.
      this.attempts = 0;
      this.notLiveAttempts = 0;
      if ((msg as { type?: string })?.type === "call_ended") this.ended = true;
      this.handlers.onMessage(msg);
    };

    ws.onclose = (ev) => {
      if (this.closed || ws !== this.ws) return;
      this.ws = undefined;
      if (this.ended) return; // reported via the call_ended message
      // A normal close from the server is the end of the stream, whatever
      // reason text it carries; only abnormal closes are worth a retry.
      if (ev.code === WS_CLOSE_NORMAL) {
        this.ended = true;
        this.handlers.onEnd();
        return;
      }
      if (ev.code === WS_CLOSE_NOT_LIVE) {
        if (++this.notLiveAttempts >= MAX_ATTEMPTS) {
          return this.fail("Call not live");
        }
        return this.reconnect(this.notLiveAttempts - 1);
      }
      if (ev.code >= 4000 && ev.code <= 4999) {
        return this.fail(ev.reason || `monitor rejected (code ${ev.code})`);
      }
      if (++this.attempts > MAX_ATTEMPTS) {
        return this.fail("Lost connection to the call monitor");
      }
      this.reconnect(this.attempts - 1);
    };
    // onerror is always followed by onclose; decide there.
    ws.onerror = () => {};
  }

  public close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }

  private reconnect(attempt: number): void {
    this.timer = setTimeout(() => this.open(), backoffMs(attempt));
  }

  private fail(message: string): void {
    this.close();
    this.handlers.onError(new Error(message));
  }
}
