# retell-client-js-sdk

Browser SDK for Retell voice calls: start a web call with an agent, or watch
an ongoing call — transcript, live audio, and take-over.

See the [Retell AI Web Call Guide](https://docs.retellai.com/deploy/web-call)
for the end-to-end setup.

## Install

```
npm install retell-client-js-sdk
```

## Usage

```ts
import { RetellClient } from "retell-client-js-sdk";

const client = new RetellClient({ key: "public_key_..." });
```

The key is checked against its allowed domains; scope it to what the page
needs.

The backend reports which SDK versions it supports: behind the recommended
version logs a `console.error`; below the minimum also emits `error` on the
session.

### Start a web call

```ts
// Call this from a click: the microphone prompt happens here.
const call = client.createWebCall({
  agent_id: "agent_...",
  // Any other /v3/create-web-call body field goes here as-is.
  retell_llm_dynamic_variables: { customer_name: "Ada" },
  hooks: {
    onStatus: (status) => console.log(status), // connecting → live → ended
    onEnd: ({ disconnection_reason }) => console.log("ended", disconnection_reason),
    // Mic denied, key rejected, connection lost: all arrive here.
    onError: (err) => console.error(err),
  },
});

// The session is returned before it connects. Awaiting is optional: `ready`
// settles when the call goes live, and rejects for what onError already saw.
await call.ready;

call.mute();
call.unmute();

await call.end(); // leaving is what ends a web call
```

`transcript: true` adds the transcript stream, and with it everything the
call itself cannot report: what was said (`onTranscript`), which node the agent
is on (`onNodeTransition`), and why the call ended (`disconnection_reason` on
`onEnd`). Without it a web call still reports `status`, `end` and `error`, but
nothing about the conversation — see [Events](#events). It needs a key with
`Call.Write`, which a public key
scoped to web calls alone won't have, so it is off by default. If the stream is
refused or dropped the call itself goes on.

### Watch an ongoing call

```ts
// The transcript starts flowing right away; audio and mic are separate steps.
const watch = client.monitorCall({
  call_id: "call_...",
  hooks: {
    // connecting → monitoring → listening → taken_over → ended
    onStatus: (status) => console.log(status),
    // The whole list on every change — replace what you render, don't append.
    // A second argument carries an earlier leg's transcript (a transfer).
    onTranscript: (transcript) => {
      const last = transcript[transcript.length - 1];
      // Tool calls, node transitions and DTMF ride the same list.
      if (last?.role === "agent" || last?.role === "user") {
        console.log(last.role, last.content);
      }
    },
    onEnd: ({ disconnection_reason }) => console.log("ended", disconnection_reason),
    onError: (err) => console.error(err),
  },
});

// Autoplay: call from a user gesture. If it throws, the session is untouched
// and still on the transcript, so the operator can click again.
await watch.listen();
watch.stopListening(); // back to transcript only

// Steer the agent without taking the call over.
await watch.update({
  call_control: {
    additional_context: "The customer is a Gold member; waive the fee.",
    trigger_response: true,
  },
});

// Irreversible: prompts for the mic first, so a denial leaves the AI running.
await watch.takeOver();
watch.mute();
watch.unmute();

await watch.end(); // hangs up for everyone
// watch.disconnect() instead just leaves, and the call goes on — except
// after a take-over, where our leaving is what ends it.
```

On a monitored call the transcript is on by default, so a transcript-only view
is the session with nothing else called; `transcript: false` drops it for an
audio-only one.
`listen()` needs a user gesture (autoplay), and `takeOver()` asks for the
microphone before it silences the AI — a denied prompt leaves the call as it was.

Monitoring needs a wider key than a web call does, so keep it somewhere you
control: a public key with tight allowed domains and reCAPTCHA, a page behind
your own auth, or a proxy that keeps the key on your server:

```ts
const PROXY = "https://app.example.com/retell"; // wherever your server runs

const client = new RetellClient({
  key: "unused", // your proxy sets the real Authorization header
  // /v3/create-web-call → https://app.example.com/retell/v3/create-web-call
  fetch: (url, init) => fetch(PROXY + new URL(String(url)).pathname, init),
});
```

That route holds the real key. A minimal Express example:

```js
app.use("/retell", express.json(), async (req, res) => {
  if (!req.session?.user) return res.sendStatus(401); // your own auth

  const upstream = await fetch("https://api.retellai.com" + req.url, {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
    },
    body: JSON.stringify(req.body),
  });

  res.status(upstream.status).send(await upstream.text());
});
```

`fetch` covers the requests and nothing else: the transcript stream is a
WebSocket that carries the key itself, so a page that renders the transcript
needs the key in the browser, and belongs behind your own auth instead.

### Events

Hooks are listeners bound at creation; `session.on(event, fn)` does the same
thing later.

| Event | Hook | Payload | Notes |
| --- | --- | --- | --- |
| `status` | `onStatus` | `SessionStatus` | every transition, `ended` included |
| `transcript` | `onTranscript` | `(transcript, preSessionTranscript)` | the whole list each time; the second is an earlier leg, usually empty |
| `node_transition` | `onNodeTransition` | `NodeTransitionEvent \| LiveCallNodeTransition` | only when the transcript stream is on |
| `audio` | `onAudio` | `Float32Array` | needs `audio: { emitRawAudioSamples: true }` |
| `end` | `onEnd` | `CallEndedEvent` | `disconnection_reason` only when the transcript stream is on |
| `error` | `onError` | `Error` | non-fatal ones too; `status` says whether the session survived |

Anything newer from the backend is dropped rather than passed through, so
upgrading the backend never surprises an older page. The `audio` snapshots are
analyser samples taken on animation frames, not continuous PCM.

### Per-request options

If the public key has reCAPTCHA enabled, every request takes an optional
`recaptchaToken` (a fresh v3 token — they are single-use):
`createWebCall({ agent_id, recaptchaToken, hooks })`, `listen({ recaptchaToken })`,
`takeOver({ recaptchaToken })`, `update(body, { recaptchaToken })`, and on a
monitored call `end({ recaptchaToken })` (a web call's `end()` makes no
request). How you obtain the token is up to you; the SDK does not load
Google's script.

The same options object takes `extra` — request fields this SDK version
doesn't list yet, merged into the body as-is.

### Without a session

```ts
await client.stopCall(callId);
await client.updateLiveCall(callId, { fields_to_override: { metadata: {...} } });
```

## Migrating from 2.x

`RetellWebClient` still ships and works unchanged (`startCall({ accessToken })`,
`stopCall()`, the same events), so 2.x code keeps running. It is deprecated
and will be removed in 4.0: `RetellClient.createWebCall()` replaces the
create-web-call request plus `startCall`, and `monitorCall()` replaces
hand-rolled live-listen / take-over flows.

One behavioural difference to plan for: 2.x calls emitted
`agent_start_talking`, `agent_stop_talking`, `update` and `metadata`; the calls
`createWebCall()` creates do not. A page that drove a talking indicator or read
`update.transcript` wants `transcript: true` and the transcript events
instead.

## Development and releases

Use Node.js 24, run `npm ci`, then `npm run check`. The checks typecheck the
source, build all bundles, install the packed tarball in a temporary project,
and verify its CommonJS, ES module, UMD, and TypeScript entry points.
CI runs these checks on PRs and pushes to `main`.

[Release Please](https://github.com/googleapis/release-please) maintains a release
PR with a version bump and changelog. Use Conventional Commit titles for squash
merges, or Conventional Commit messages for commits that enter `main`:
`fix:` releases a patch, `feat:` releases a minor, and `feat!:` or a
`BREAKING CHANGE:` footer releases a major. Review and merge the release PR
when ready to publish. The Release workflow creates a `vX.Y.Z` tag and GitHub
release, checks out that release commit, runs `npm run check`, and publishes
to npm. The publish hook rebuilds `dist` and generates `src/version.ts` from
the released package version.

The workflow uses `GITHUB_TOKEN` and explicitly dispatches CI for release PRs.
Under Settings → Actions → General, allow GitHub Actions to create pull requests.
Make the CI `Validate package` check required in the branch rules for `main`.

Before merging the first release PR, configure
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) in the npm
settings for `retell-client-js-sdk`. Choose GitHub Actions with organization
`RetellAI`, repository `retell-client-js-sdk`, and workflow filename `release.yml`.
Leave the environment name empty and allow publishing. The workflow uses
Node.js 24 and npm 11 with OIDC; it needs no npm token.

The release manifest starts at the published 3.0.1 commit. Merge the automation
change with a `fix:` title to start the first patch release PR for 3.0.2.
The earlier takeover commits have no Conventional Commit prefix, so add their
fix to the first release PR's changelog before merging it. Later releases use
the previous release as their starting point.

If npm publication fails after the GitHub release is created, correct the
configuration and use **Re-run failed jobs** on that Release run. This reruns
the publish job with the original release commit and version.
