# Demo page

`index.html` exercises both browser-side flows against a running backend:

- **Web call** — `POST /v2/create-web-call`, then join with whatever transport
  the backend chose.
- **Live-listen + take-over** — `POST /v2/listen-live-call/:id` joins a phone call
  hidden and receive-only; `POST /v2/take-over-live-call/:id` followed by
  `takeOver()` then opens the mic on that same connection.

The page never picks the transport itself — it reads the backend's response. A
gateway call comes back with `transport: "gateway"` plus the instance the call is
pinned to (`gateway_url`) and its room coordinates; a LiveKit call comes back with
just a room-scoped `access_token`. `toStartConfig()` in the page is the entire
mapping, about fifteen lines.

## Running it

```sh
npm install       # once
npm run build     # produces dist/
npx serve .       # any static server, from the REPO ROOT
# open http://localhost:3000/examples/
```

Two constraints on how you serve it:

- **`http://localhost`, not `file://`.** `getUserMedia` needs a secure context and
  localhost counts as one; `file://` does not, so the mic just fails there.
- **Serve from the repo root**, not from `examples/`. The page loads the SDK from
  `../dist/` and resolves its two dependencies out of `../node_modules/` via an
  import map, because the published `dist/` deliberately keeps `livekit-client`
  and `eventemitter3` external. No bundling step — but those paths have to
  resolve.

A page served over https cannot call an http backend or gateway (mixed content),
which matters as soon as you point this at a deployed environment rather than
localhost.

## API key

The page sends your API key straight from the browser. Fine for local testing,
wrong for anything else: a real integration mints call tokens on its own server
and hands the browser only the short-lived result.

## What to expect

A gateway web call takes slightly longer to join than a LiveKit one. The room is
created by the agent's orchestrator, not by the browser, so the SDK retries the
WHIP create until the room exists (up to 15s). In the log pane, `call_started` is
signaling established; `call_ready` is audio actually flowing.

The take-over button only enables on a gateway call — LiveKit take-over goes
through a different backend path that this page doesn't drive. Order matters
there: the backend grants publish first, and only then does the browser open its
mic and renegotiate. The gateway drops uplink audio from a session it hasn't
promoted, no matter what the browser sends.
