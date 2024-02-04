## Introduction

This is the Javascript client SDK which you can use in your web application to start the conversation with Retell AI agent

## Set up

In your web applicaiton project, install the SDK

`npm retell-client-js-sdk`


## How to use

```javascript
import { RetellClientSdk } from "retell-client-js-sdk";

const sdk = new RetellClientSdk();


// Setup event listeners
sdk.on("onConversationStarted", () => {
    console.log("Conversation started");
});

sdk.on("onConversationEnded", () => {
    console.log("Conversation ended");
});

sdk.on("onError", (error) => {
    console.error("An error occurred:", error);
});

// Open the mic and create conversation with the agent
// Your server can get the callId using this API: https://docs.re-tell.ai/api-references/post-register-call
sdk.startConversation({
        callId,
});

// Advanced parameters
sdk.startConversation({
        callId: callId,
        sampleRate: 44000,  // You can specify a samping rate receiving from the server and playing at your client
        customStream: yourStream, // You can use your own MediaStream which might use a different mic
}

// Stop the conversation
sdk.stopConversation();
```

More details on how to use the SDK can be found in this react demo: https://github.com/adam-team/retell-frontend-reactjs-demo/blob/client_sdk/src/App.tsx 