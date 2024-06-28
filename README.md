### Set up the SDK

Step 1: Install the Retell Web SDK

`npm install retell-client-js-sdk`

Step 2: Set up the SDK class

```javascript
import { RetellWebClient } from "retell-client-js-sdk";

const retellWebClient = new RetellWebClient();
```

### Call `create-call` to get call id

Your client code should call your server endpoint which calls
[create call](https://docs.retellai.com/api-references/create-call) to get the
call id and access token. The endpoint requires using the API Key, which is the
reason why you need to call the endpoint from the server instead of client to
protect the key from exposing.

### Start the Call

Once call starts, you can listen to a couple events that's emitted for real time
updates about the call.

```javascript
await retellWebClient.startCall({
  accessToken: createCallResponse.access_token,
});
```

There are other optional options that allow you to set the sample rate of call,
audio capture and playback device, whether to receive raw audio bytes from the
client.

```javascript
await retellWebClient.startCall({
  accessToken: createCallResponse.access_token,
  sampleRate: 24000, // (Optional) set sample rate of the audio capture and playback
  // (Optional) device id of the mic.
  captureDeviceId: "default",
  // (Optional) device id of the speaker
  playbackDeviceId:
    "0ec1807fd0fe6e51b990660ec4e2ebb78sdfcba51e279815d00c423ce03407ff",
  // (Optional) Whether to emit "audio" events that contain raw pcm audio bytes represented by Float32Array
  emitRawAudioSamples: false,
});
```

### Stop the Call

You can close a web call with the agent by using

```javascript
retellWebClient.stopCall();
```

### Listen to events

```javascript
retellWebClient.on("call_started", () => {
  console.log("call started");
});

retellWebClient.on("call_ended", () => {
  console.log("call ended");
  setIsCallActive(false);
});

// When agent starts talking for the utterance
// useful for animation
retellWebClient.on("agent_start_talking", () => {
  console.log("agent_start_talking");
});

// When agent is done talking for the utterance
// useful for animation
retellWebClient.on("agent_stop_talking", () => {
  console.log("agent_stop_talking");
});

// Real time pcm audio bytes being played back, in format of Float32Array
// only available when emitRawAudioSamples is true
retellWebClient.on("audio", (audio) => {
  // console.log(audio);
});

// Update message such as transcript
retellWebClient.on("update", (update) => {
  // console.log(update);
});

retellWebClient.on("metadata", (metadata) => {
  // console.log(metadata);
});

retellWebClient.on("error", (error) => {
  console.error("An error occurred:", error);
  // Stop the call
  retellWebClient.stopCall();
});
```

### Audio Basics

If you have not worked with audio bytes before, we stronly suggest you to check
out [audio basics](/knowledge/audio-basics), which can help with choosing the
best configuration here.

PCM audio format conversion functions `convertUnsigned8ToFloat32` and
`convertFloat32ToUnsigned8` can be found in
[audio basics](/knowledge/audio-basics#pcm-audio-representation).

### Attach Custom Audio Node

For animation or analysis purposes, you might want to attach specific audio
nodes to the call. You can do that by modidying this SDK locally.

Reference the code where we attach the audioAnalyzerNode to see how it's
attached.

```javascript
track.setWebAudioPlugins([
  this.audioAnalyzerNode,
  yourCustomNode,
  yetAnotherNode,
]);
```
