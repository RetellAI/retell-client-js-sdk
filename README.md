## Introduction

This is the Javascript client SDK which you can use in your web application to start the conversation with Retell AI agent

## Set up

In your web applicaiton project, install the SDK

`npm retell-client-js-sdk`


## How to use

```
import { RetellClientSdk } from "retell-client-js-sdk";

const newSdk = new RetellClientSdk("YOUR_RETELL_API_KEY");


// Open the mic and create conversation with the agent
sdk?.startConversation({
        "YOUR_AGENT_ID",
      });
```