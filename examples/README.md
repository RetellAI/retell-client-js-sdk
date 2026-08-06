# Local end-to-end: gateway web call

`gateway-webcall.html` drives a full local chain against the new
sip-webrtc-gateway WebRTC leg:

```
browser (this page) → POST {backend}/v2/create-web-call-gateway
                    → SDK gateway transport → local sip-webrtc-gateway (WHIP/Opus)
```

The backend's dev-only `/v2/create-web-call-gateway` endpoint mints the per-call
browser token and returns `{ transport, gatewayUrl, callId, callToken, identity,
iceServers }`; the SDK auto-selects the gateway transport from those fields.

## 1. Build the SDK bundle

The published `dist/` keeps `livekit-client` external, so a plain browser can't
load it directly. Build a self-contained bundle from the local source:

```sh
npm install            # once, for livekit-client + deps
npx esbuild src/index.ts --bundle --format=iife --global-name=_retell \
  --footer:js='window.RetellWebClient=_retell.RetellWebClient' \
  --outfile=examples/retell-sdk.bundle.js
```

(Re-run after changing `src/`.)

## 2. Run the gateway (open mode or token mode)

Token mode matches production; its secret/iss must equal the backend's:

```sh
# in sip-webrtc-gateway/
make build
GATEWAY_LOAD_SECRETS=0 WEBRTC_ENABLED=1 WEBRTC_ICE_PUBLIC_IP=127.0.0.1 \
  HTTP_LISTEN=127.0.0.1:8088 \
  GATEWAY_WEB_TOKEN_SECRET=local-dev-web-token-secret-0123456789 \
  GATEWAY_WEB_TOKEN_ISS=retell-web \
  ./bin/sip-webrtc-gateway
```

## 3. Run the backend

Start retell-backend in development (`NODE_ENV=development`) with the matching
gateway vars set (see `.env.development`: `GATEWAY_WEB_TOKEN_SECRET`,
`GATEWAY_WEB_TOKEN_ISS`, `GATEWAY_BASE_URL_OVERRIDE`). The dev endpoint is only
mounted when `NODE_ENV !== "production"`.

## 4. Serve this page + open it

`getUserMedia` needs a secure context, so serve over `localhost` (not `file://`):

```sh
python3 -m http.server 8090 --directory examples
# open http://localhost:8090/gateway-webcall.html
```

Set the backend URL, click **Join** (a user gesture — required for mic + audio
autoplay). To bridge **two tabs** through one room mixer, open the page twice with
the **same `call_id`** (the field defaults to `local-e2e-1`); both browsers join
`main_<call_id>` and hear each other. The endpoint honors the posted `call_id` so
the two legs co-locate.

> Note: the real agent leg (orchestrator ↔ gateway) is not on `main` yet — it
> lives on the backend's media-refactor branch. This harness validates
> browser → backend → gateway (audio + per-call token auth); the AI-agent half
> comes with that branch.
