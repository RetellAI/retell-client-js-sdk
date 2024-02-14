### Set up the SDK

Step 1: Install the Client JS SDK

`npm install retell-client-js-sdk`

Step 2: Set up the SDK class

```javascript
import { RetellWebClient } from "retell-client-js-sdk";

const sdk = new RetellWebClient();
```

### Call `register-call` to get call id

Your client code should call your server endpoint which calls [register call](https://docs.retellai.com/api-references/register-call) to get the call id. The endpoint requires using the API Key, which is the reason why you need to call the endpoint from the server instead of client to protect the key from exposing.

### Start the conversation


 to get a `call id` and pass to the client

```javascript
sdk.startConversation({
  callId: registerCallResponse.call_id,
  sampleRate: registerCallResponse.sample_rate
});
```

```javascript
// Advanced parameters
sdk.startConversation({
        callId: callId,
        sampleRate: 44100,  // Your server will call `register-call` with the sample_rate, then return the sample rate to the client
        enableUpdate: true, // You want to receive the update event such as transcript
        customStream: yourStream, // You can use your own MediaStream which might use a different mic
});
```


### Stop the conversation

You can close a web call with the agent by using

```javascript
sdk.stopConversation()
```

### Listen to events

```javascript
// Setup event listeners
// When the whole agent and user conversation starts
sdk.on("conversationStarted", () => {
    console.log("Conversation started");
});

// When the whole agent and user conversation ends
sdk.on("conversationEnded", () => {
    console.log("Conversation ended");
});

sdk.on("error", (error) => {
    console.error("An error occurred:", error);
});
```

## Advanced

If you would like show animatioh according to user speech or agent speech, you can utilize `update` event.

In update, we will provide the update such as transcript. It will be the transcript for both user and agent in an incremental way. For example, during the conversation it will print


```javascript
[
{role: 'agent', content: 'Hey there, '}
]
```

```javascript
[
{role: 'agent', content: 'Hey there, I\'m'}
]
```

```javascript
[
{role: 'agent', content: 'Hey there, I\'m your personal AI therapist'}
]
```

```javascript
[
{role: 'agent', content: 'Hey there, I\'m your personal AI therapist'},
{role: 'user', content: 'Hey, '}
]
```

```javascript
[
{role: 'agent', content: 'Hey there, I\'m your personal AI therapist'},
{role: 'user', content: 'Hey, how are you?'}
]
```

```
Check out the code at [React Demo on GitHub](https://github.com/adam-team/retell-frontend-reactjs-demo/) for a practical example. All code in this guide is from this repository.

If you have not worked with audio bytes before, we stronly suggest you to check
out [audio basics](/knowledge/audio-basics), which can help with choosing the
best configuration here.

PCM audio format conversion functions `convertUnsigned8ToFloat32` and
`convertFloat32ToUnsigned8` can be found in
[audio basics](/knowledge/audio-basics#pcm-audio-representation), and is available in Node SDK.
```