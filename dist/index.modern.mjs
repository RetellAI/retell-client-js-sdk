import{EventEmitter as t}from"eventemitter3";import e from"isomorphic-ws";class i extends t{constructor(t){super(),this.ws=void 0,this.pingTimeout=null,this.pingInterval=null,this.wasDisconnected=!1,this.pingIntervalTime=5e3;let i=(t.customEndpoint||"wss://api.retellai.com/audio-websocket/")+t.callId;t.enableUpdate&&(i+="?enable_update=true"),this.ws=new e(i),this.ws.binaryType="arraybuffer",this.ws.onopen=()=>{this.emit("open"),this.startPingPong()},this.ws.onmessage=t=>{if("string"==typeof t.data)if("pong"===t.data)this.wasDisconnected&&(this.emit("reconnect"),this.wasDisconnected=!1),this.adjustPingFrequency(5e3);else if("clear"===t.data)this.emit("clear");else try{const e=JSON.parse(t.data);"update"===e.event_type?this.emit("update",e):"metadata"===e.event_type&&this.emit("metadata",e)}catch(t){console.log(t)}else if(t.data instanceof ArrayBuffer){const e=new Uint8Array(t.data);this.emit("audio",e)}else console.log("error","Got unknown message from server.")},this.ws.onclose=t=>{this.stopPingPong(),this.emit("close",t.code,t.reason)},this.ws.onerror=t=>{this.stopPingPong(),this.emit("error",t.error)}}startPingPong(){this.pingInterval=setInterval(()=>this.sendPing(),this.pingIntervalTime),this.resetPingTimeout()}sendPing(){this.ws.readyState===e.OPEN&&this.ws.send("ping")}adjustPingFrequency(t){this.pingIntervalTime!==t&&(null!=this.pingInterval&&clearInterval(this.pingInterval),this.pingIntervalTime=t,this.startPingPong())}resetPingTimeout(){null!=this.pingTimeout&&clearTimeout(this.pingTimeout),this.pingTimeout=setTimeout(()=>{5e3===this.pingIntervalTime&&(this.adjustPingFrequency(1e3),this.pingTimeout=setTimeout(()=>{this.emit("disconnect"),this.wasDisconnected=!0},3e3))},this.pingIntervalTime)}stopPingPong(){null!=this.pingInterval&&clearInterval(this.pingInterval),null!=this.pingTimeout&&clearTimeout(this.pingTimeout)}send(t){1===this.ws.readyState&&this.ws.send(t)}close(){this.ws.close()}}function n(t){const e=new ArrayBuffer(2*t.length),i=new DataView(e);for(let e=0;e<t.length;e++)i.setInt16(2*e,32768*t[e],!0);return new Uint8Array(e)}class s extends t{constructor(t){super(),this.liveClient=void 0,this.audioContext=void 0,this.isCalling=!1,this.stream=void 0,this.audioNode=void 0,this.customEndpoint=void 0,this.captureNode=null,this.audioData=[],this.audioDataIndex=0,this.isTalking=!1,t&&(this.customEndpoint=t)}async startConversation(t){try{await this.setupAudioPlayback(t.sampleRate,t.customStream,t.customSinkId),this.liveClient=new i({callId:t.callId,enableUpdate:t.enableUpdate,customEndpoint:this.customEndpoint}),this.handleAudioEvents(),this.isCalling=!0}catch(t){this.emit("error",t.message)}}stopConversation(){var t,e,i,n,s;this.isCalling=!1,null==(t=this.liveClient)||t.close(),null==(e=this.audioContext)||e.suspend(),null==(i=this.audioContext)||i.close(),this.isAudioWorkletSupported()?(null==(s=this.audioNode)||s.disconnect(),this.audioNode=null):this.captureNode&&(this.captureNode.disconnect(),this.captureNode.onaudioprocess=null,this.captureNode=null,this.audioData=[],this.audioDataIndex=0),this.liveClient=null,null==(n=this.stream)||n.getTracks().forEach(t=>t.stop()),this.audioContext=null,this.stream=null}handleAudioEvents(){this.liveClient.on("open",()=>{this.emit("conversationStarted")}),this.liveClient.on("audio",t=>{this.playAudio(t)}),this.liveClient.on("disconnect",()=>{this.emit("disconnect")}),this.liveClient.on("reconnect",()=>{this.emit("reconnect")}),this.liveClient.on("error",t=>{this.emit("error",t),this.isCalling&&this.stopConversation()}),this.liveClient.on("close",(t,e)=>{this.isCalling&&this.stopConversation(),this.emit("conversationEnded",{code:t,reason:e})}),this.liveClient.on("update",t=>{this.emit("update",t)}),this.liveClient.on("metadata",t=>{this.emit("metadata",t)}),this.liveClient.on("clear",()=>{this.isAudioWorkletSupported()?this.audioNode.port.postMessage("clear"):(this.audioData=[],this.audioDataIndex=0,this.isTalking&&(this.isTalking=!1,this.emit("agentStopTalking")))})}async setupAudioPlayback(t,e,i){this.audioContext=new AudioContext({sampleRate:t}),i&&(this.audioContext.setSinkId(i),console.log("Hello Anne, setting sinkId"));try{this.stream=e||await navigator.mediaDevices.getUserMedia({audio:{sampleRate:t,echoCancellation:!0,noiseSuppression:!0,channelCount:1}})}catch(t){throw new Error("User didn't give microphone permission")}if(this.isAudioWorkletSupported()){console.log("Audio worklet starting"),this.audioContext.resume();const t=new Blob(['\nclass captureAndPlaybackProcessor extends AudioWorkletProcessor {\n    audioData = [];\n    index = 0;\n    isTalking = false;\n  \n    constructor() {\n      super();\n      //set listener to receive audio data, data is float32 array.\n      this.port.onmessage = (e) => {\n        if (e.data === "clear") {\n          // Clear all buffer.\n          this.audioData = [];\n          this.index = 0;\n          if (this.isTalking) {\n            this.isTalking = false;\n            this.port.postMessage("agent_stop_talking");\n          }\n        } else if (e.data.length > 0) {\n          this.audioData.push(this.convertUint8ToFloat32(e.data));\n          if (!this.isTalking) {\n            this.isTalking = true;\n            this.port.postMessage("agent_start_talking");\n          }\n        }\n      };\n    }\n  \n    convertUint8ToFloat32(array) {\n      const targetArray = new Float32Array(array.byteLength / 2);\n    \n      // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer\n      const sourceDataView = new DataView(array.buffer);\n    \n      // Loop through, get values, and divide by 32,768\n      for (let i = 0; i < targetArray.length; i++) {\n        targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);\n      }\n      return targetArray;\n    }\n  \n    convertFloat32ToUint8(array) {\n      const buffer = new ArrayBuffer(array.length * 2);\n      const view = new DataView(buffer);\n    \n      for (let i = 0; i < array.length; i++) {\n        const value = array[i] * 32768;\n        view.setInt16(i * 2, value, true); // true for little-endian\n      }\n    \n      return new Uint8Array(buffer);\n    }\n  \n    process(inputs, outputs, parameters) {\n      // Capture\n      const input = inputs[0];\n      const inputChannel1 = input[0];\n      const inputChannel2 = input[1];\n      this.port.postMessage(["capture", this.convertFloat32ToUint8(inputChannel1)]);\n  \n      // Playback\n      const output = outputs[0];\n      const outputChannel1 = output[0];\n      const outputChannel2 = output[1];\n      // start playback.\n      for (let i = 0; i < outputChannel1.length; ++i) {\n        if (this.audioData.length > 0) {\n          outputChannel1[i] = this.audioData[0][this.index];\n          outputChannel2[i] = this.audioData[0][this.index];\n          this.index++;\n          if (this.index == this.audioData[0].length) {\n            this.audioData.shift();\n            this.index = 0;\n          }\n        } else {\n          outputChannel1[i] = 0;\n          outputChannel2[i] = 0;\n        }\n      }\n\n      this.port.postMessage(["playback", this.convertFloat32ToUint8(outputChannel1)]);\n      if (!this.audioData.length && this.isTalking) {\n        this.isTalking = false;\n        this.port.postMessage("agent_stop_talking");\n      }\n  \n      return true;\n    }\n  }\n  \n  registerProcessor(\n    "capture-and-playback-processor",\n    captureAndPlaybackProcessor,\n  );\n'],{type:"application/javascript"}),e=URL.createObjectURL(t);await this.audioContext.audioWorklet.addModule(e),console.log("Audio worklet loaded"),this.audioNode=new AudioWorkletNode(this.audioContext,"capture-and-playback-processor"),console.log("Audio worklet setup"),this.audioNode.port.onmessage=t=>{let e=t.data;if(Array.isArray(e)){let t=e[0];var i;"capture"===t?null==(i=this.liveClient)||i.send(e[1]):"playback"===t&&this.emit("audio",e[1])}else"agent_stop_talking"===e?this.emit("agentStopTalking"):"agent_start_talking"===e&&this.emit("agentStartTalking")},this.audioContext.createMediaStreamSource(this.stream).connect(this.audioNode),this.audioNode.connect(this.audioContext.destination)}else{const t=this.audioContext.createMediaStreamSource(this.stream);this.captureNode=this.audioContext.createScriptProcessor(2048,1,1),this.captureNode.onaudioprocess=t=>{if(this.isCalling){const e=n(t.inputBuffer.getChannelData(0));this.liveClient.send(e);const i=t.outputBuffer.getChannelData(0);for(let t=0;t<i.length;++t)this.audioData.length>0?(i[t]=this.audioData[0][this.audioDataIndex++],this.audioDataIndex===this.audioData[0].length&&(this.audioData.shift(),this.audioDataIndex=0)):i[t]=0;this.emit("audio",n(i)),!this.audioData.length&&this.isTalking&&(this.isTalking=!1,this.emit("agentStopTalking"))}},t.connect(this.captureNode),this.captureNode.connect(this.audioContext.destination)}}isAudioWorkletSupported(){return/Chrome/.test(navigator.userAgent)&&/Google Inc/.test(navigator.vendor)}playAudio(t){if(this.isAudioWorkletSupported())this.audioNode.port.postMessage(t);else{const e=function(t){const e=new Float32Array(t.byteLength/2),i=new DataView(t.buffer);for(let t=0;t<e.length;t++)e[t]=i.getInt16(2*t,!0)/Math.pow(2,15);return e}(t);this.audioData.push(e),this.isTalking||(this.isTalking=!0,this.emit("agentStartTalking"))}}}export{s as RetellWebClient};
