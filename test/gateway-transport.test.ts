import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { GatewayTransport } from "../src/gateway-transport";

// Minimal browser stand-ins: only what GatewayTransport touches.
class FakeTrack {
  stopped = false;
  enabled = true;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

class FakePeerConnection {
  connectionState = "new";
  iceConnectionState = "new";
  transceivers: any[] = [];
  localDescription: { sdp: string } | null = null;
  addTransceiver(_kind: string, init: { direction: string }) {
    const tx = {
      direction: init.direction,
      sender: { replaceTrack: async () => {} },
    };
    this.transceivers.push(tx);
    return tx;
  }
  getTransceivers() {
    return this.transceivers;
  }
  addTrack() {}
  createDataChannel() {
    return { close() {} };
  }
  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }
  async setLocalDescription(d: { sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription() {}
  close() {}
}

const handlers = {
  onConnected() {},
  onCallReady() {},
  onData() {},
  onDisconnected() {},
  onError() {},
};

describe("GatewayTransport.takeOver", () => {
  const g = globalThis as any;
  let streams: FakeStream[];
  let patchStatus: number;
  let patchGate: Promise<void> | undefined;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    streams = [];
    patchStatus = 200;
    patchGate = undefined;
    saved = {
      RTCPeerConnection: g.RTCPeerConnection,
      fetch: g.fetch,
    };
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(g, "navigator");
    saved.navigatorDescriptor = navigatorDescriptor;
    g.RTCPeerConnection = FakePeerConnection;
    Object.defineProperty(g, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => {
            const s = new FakeStream();
            streams.push(s);
            return s;
          },
        },
      },
    });
    g.fetch = async (_url: string, init: { method: string }) => {
      if (init.method === "POST") {
        return {
          ok: true,
          json: async () => ({ session_id: "s1", sdp: "answer-sdp" }),
        };
      }
      await patchGate;
      return {
        ok: patchStatus === 200,
        status: patchStatus,
        text: async () => "answer-sdp",
      };
    };
  });

  afterEach(() => {
    g.RTCPeerConnection = saved.RTCPeerConnection;
    g.fetch = saved.fetch;
    const d = saved.navigatorDescriptor as PropertyDescriptor | undefined;
    if (d) Object.defineProperty(g, "navigator", d);
    else delete g.navigator;
  });

  async function connectListener() {
    const transport = new GatewayTransport({
      accessToken: "token",
      transport: "gateway",
      callId: "call_1",
      listener: true,
    });
    await transport.connect(handlers);
    return transport;
  }

  it("publishes the mic on a successful take-over", async () => {
    const transport = await connectListener();
    await transport.takeOver();
    assert.equal(streams.length, 1);
    assert.equal(streams[0].tracks[0].stopped, false);
  });

  it("releases the mic when the renegotiation is rejected", async () => {
    const transport = await connectListener();
    patchStatus = 500;
    await assert.rejects(transport.takeOver(), /take-over renegotiation failed/);
    assert.equal(streams[0].tracks[0].stopped, true);
  });

  it("publishes on a retry after a rejected renegotiation", async () => {
    const transport = await connectListener();
    patchStatus = 500;
    await assert.rejects(transport.takeOver());

    patchStatus = 200;
    await transport.takeOver();
    assert.equal(streams.length, 2, "the retry must acquire a new mic stream");
    assert.equal(streams[1].tracks[0].stopped, false);
  });

  it("releases the mic when the transport is closed during the renegotiation", async () => {
    const transport = await connectListener();
    let release!: () => void;
    patchGate = new Promise<void>((resolve) => (release = resolve));

    const takingOver = transport.takeOver();
    await new Promise((resolve) => setImmediate(resolve));
    transport.close();
    release();

    await assert.rejects(takingOver);
    assert.equal(streams[0].tracks[0].stopped, true);
  });

  it("does nothing on a second call once publishing", async () => {
    const transport = await connectListener();
    await transport.takeOver();
    await transport.takeOver();
    assert.equal(streams.length, 1);
  });
});
