const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { EventEmitter } = require("eventemitter3");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createMonitor(getUserMedia) {
  const requests = [];
  let published = 0;
  class Room extends EventEmitter {
    constructor() {
      super();
      this.localParticipant = Object.assign(new EventEmitter(), {
        permissions: { canPublish: true },
        publishTrack: async () => {
          published++;
        },
      });
    }
    async connect() {}
    async startAudio() {}
    async disconnect() {
      // LiveKit disconnects asynchronously after acquiring its room lock.
      await Promise.resolve();
      this.emit("disconnected");
    }
  }
  const sandbox = {
    TextDecoder,
    TextEncoder,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    console,
    navigator: { mediaDevices: { getUserMedia } },
    eventemitter3: EventEmitter,
    livekitClient: {
      Room,
      RoomEvent: {
        Disconnected: "disconnected",
        ParticipantDisconnected: "participantDisconnected",
        TrackSubscribed: "trackSubscribed",
        DataReceived: "dataReceived",
      },
      ParticipantEvent: { ParticipantPermissionsChanged: "permissionsChanged" },
      createLocalAudioTrack: async () => ({ stop() {} }),
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../dist/index.umd.js"), "utf8"),
    sandbox,
  );
  const client = new sandbox.retellClientJsSdk.RetellClient({
    key: "public_key_test",
    fetch: async (url) => {
      requests.push(new URL(url).pathname);
      return new Response(
        JSON.stringify({
          access_token: "test-token",
          participant_id: "test-participant",
          transport: "livekit",
        }),
      );
    },
  });
  return {
    session: client.monitorCall({ call_id: "call_test", transcript: false }),
    requests,
    published: () => published,
  };
}

for (const alreadyListening of [false, true]) {
  for (const action of ["disconnect", "end"]) {
    test(`${action} during microphone permission prevents take-over (listening=${alreadyListening})`, async () => {
      const permission = deferred();
      const prompted = deferred();
      let stopped = 0;
      const { session, requests, published } = createMonitor(() => {
        prompted.resolve();
        return permission.promise;
      });
      try {
        await session.ready;
        if (alreadyListening) await session.listen();
        const takingOver = session.takeOver();
        await prompted.promise;
        await session[action]();
        permission.resolve({
          getTracks: () => [
            {
              stop: () => {
                stopped++;
              },
            },
          ],
        });

        await assert.rejects(takingOver, /ended/i);
        assert.equal(session.status, "ended");
        assert.equal(
          stopped,
          1,
          "release the microphone acquired after disconnect",
        );
        assert.equal(published(), 0);
        assert.deepEqual(requests, [
          "/v2/listen-live-call/call_test",
          ...(action === "end" ? ["/v2/stop-call/call_test"] : []),
        ]);
      } finally {
        session.disconnect();
      }
    });
  }
}

test("a live monitor can still take over and release its permission probe", async () => {
  let stopped = 0;
  const { session, requests, published } = createMonitor(async () => ({
    getTracks: () => [
      {
        stop: () => {
          stopped++;
        },
      },
    ],
  }));
  try {
    await session.ready;
    await session.takeOver();

    assert.equal(session.status, "taken_over");
    assert.equal(stopped, 1);
    assert.equal(published(), 1);
    assert.deepEqual(requests, [
      "/v2/listen-live-call/call_test",
      "/v2/take-over-live-call/call_test",
    ]);
  } finally {
    session.disconnect();
  }
});

for (const alreadyListening of [false, true]) {
  test(`microphone denial leaves the AI running (listening=${alreadyListening})`, async () => {
    const { session, requests, published } = createMonitor(async () => {
      throw new Error("Permission denied");
    });
    try {
      await session.ready;
      if (alreadyListening) await session.listen();

      await assert.rejects(session.takeOver(), /Permission denied/);
      assert.equal(
        session.status,
        alreadyListening ? "listening" : "monitoring",
      );
      assert.equal(published(), 0);
      assert.deepEqual(requests, ["/v2/listen-live-call/call_test"]);
    } finally {
      session.disconnect();
    }
  });
}
