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
needs. `baseURL` points the client at another region or a proxy (default
`https://api.retellai.com`); `fetch` swaps the HTTP implementation.

The backend reports which SDK versions it supports: behind the recommended
version logs a `console.error`; below the minimum also emits `error` on the
session.

### Start a web call

```ts
const call = client.createWebCall({
  agent_id: "agent_...",           // plus any /v3/create-web-call body field
  hooks: {
    onStatus: (status) => ...,     // connecting → live → ended
    onAgentStartTalking: () => ...,
    onAgentStopTalking: () => ...,
    onEnd: ({ disconnection_reason }) => ...,
    onError: (err) => ...,
  },
});

call.mute();
call.unmute();
await call.end();
```

If the public key has reCAPTCHA enabled, every action takes an optional
`recaptchaToken` (a fresh v3 token — they are single-use):
`createWebCall({ agent_id, recaptchaToken, hooks })`, `listen({ recaptchaToken })`,
`takeOver({ recaptchaToken })`, `update(body, { recaptchaToken })`,
`end({ recaptchaToken })`. How you obtain the token is up to you; the SDK does
not load Google's script. The same options object takes `extra`, request
fields this SDK version doesn't list yet, merged into the body as-is.

### Watch an ongoing call

```ts
const watch = client.monitorCall({
  call_id: "call_...",
  hooks: {
    onStatus: (status) => ...,     // connecting → monitoring → listening → taken_over → ended
    onTranscript: (transcript, preSessionTranscript) => ...,
    onEnd: ({ disconnection_reason }) => ...,
    onError: (err) => ...,
  },
});

await watch.listen();      // join the audio, receive-only
watch.stopListening();     // back to transcript only
await watch.takeOver();    // silence the AI and talk to the caller (irreversible)
await watch.update({ call_control: { additional_context: "...", trigger_response: true } });
await watch.end();         // hang up for everyone
watch.disconnect();        // just leave; the call goes on (after a take-over, leaving ends it)
```

The transcript streams as soon as the session exists. `listen()` needs a
user gesture on most browsers (autoplay), and `takeOver()` prompts for the
microphone before anything irreversible happens — if the prompt is denied,
the AI is untouched.

### Events

Hooks are listeners bound at creation; `session.on(event, fn)` does the same
thing later. Sessions only emit the events they declare
(`status`, `transcript`, `agent_start_talking`, `agent_stop_talking`,
`update`, `metadata`, `node_transition`, `audio`, `end`, `error`); anything
newer from the backend is dropped, so upgrading the backend never surprises
an older page.

`audio` needs `audio: { emitRawAudioSamples: true }` and carries
`Float32Array` analyser snapshots for visualization — sampled on animation
frames, not a continuous PCM stream.

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
