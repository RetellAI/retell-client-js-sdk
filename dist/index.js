var t=require("eventemitter3");function e(t){return t&&"object"==typeof t&&"default"in t?t:{default:t}}var n=/*#__PURE__*/e(require("isomorphic-ws"));function i(t,e){t.prototype=Object.create(e.prototype),t.prototype.constructor=t,a(t,e)}function a(t,e){return a=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},a(t,e)}var o=/*#__PURE__*/function(t){function e(e){var i;(i=t.call(this)||this).ws=void 0,i.pingTimeout=null,i.pingInterval=null,i.wasDisconnected=!1,i.pingIntervalTime=5e3;var a=(e.customEndpoint||"wss://api.retellai.com/audio-websocket/")+e.callId;return e.enableUpdate&&(a+="?enable_update=true"),i.ws=new n.default(a),i.ws.binaryType="arraybuffer",i.ws.onopen=function(){i.emit("open"),i.startPingPong()},i.ws.onmessage=function(t){if("string"==typeof t.data)if("pong"===t.data)i.wasDisconnected&&(i.emit("reconnect"),i.wasDisconnected=!1),i.adjustPingFrequency(5e3);else if("clear"===t.data)i.emit("clear");else try{var e=JSON.parse(t.data);"update"===e.event_type?i.emit("update",e):"metadata"===e.event_type&&i.emit("metadata",e)}catch(t){console.log(t)}else if(t.data instanceof ArrayBuffer){var n=new Uint8Array(t.data);i.emit("audio",n)}else console.log("error","Got unknown message from server.")},i.ws.onclose=function(t){i.stopPingPong(),i.emit("close",t.code,t.reason)},i.ws.onerror=function(t){i.stopPingPong(),i.emit("error",t.error)},i}i(e,t);var a=e.prototype;return a.startPingPong=function(){var t=this;this.pingInterval=setInterval(function(){return t.sendPing()},this.pingIntervalTime),this.resetPingTimeout()},a.sendPing=function(){this.ws.readyState===n.default.OPEN&&this.ws.send("ping")},a.adjustPingFrequency=function(t){this.pingIntervalTime!==t&&(null!=this.pingInterval&&clearInterval(this.pingInterval),this.pingIntervalTime=t,this.startPingPong())},a.resetPingTimeout=function(){var t=this;null!=this.pingTimeout&&clearTimeout(this.pingTimeout),this.pingTimeout=setTimeout(function(){5e3===t.pingIntervalTime&&(t.adjustPingFrequency(1e3),t.pingTimeout=setTimeout(function(){t.emit("disconnect"),t.wasDisconnected=!0},3e3))},this.pingIntervalTime)},a.stopPingPong=function(){null!=this.pingInterval&&clearInterval(this.pingInterval),null!=this.pingTimeout&&clearTimeout(this.pingTimeout)},a.send=function(t){1===this.ws.readyState&&this.ws.send(t)},a.close=function(){this.ws.close()},e}(t.EventEmitter);function r(t){for(var e=new ArrayBuffer(2*t.length),n=new DataView(e),i=0;i<t.length;i++)n.setInt16(2*i,32768*t[i],!0);return new Uint8Array(e)}function s(t,e){try{var n=t()}catch(t){return e(t)}return n&&n.then?n.then(void 0,e):n}exports.RetellWebClient=/*#__PURE__*/function(t){function e(e){var n;return(n=t.call(this)||this).liveClient=void 0,n.audioContext=void 0,n.isCalling=!1,n.stream=void 0,n.audioNode=void 0,n.customEndpoint=void 0,n.captureNode=null,n.audioData=[],n.audioDataIndex=0,n.isTalking=!1,e&&(n.customEndpoint=e),n}i(e,t);var n=e.prototype;return n.startConversation=function(t){try{var e=this,n=s(function(){return Promise.resolve(e.setupAudioPlayback(t.sampleRate,t.customStream,t.customSinkId)).then(function(){e.liveClient=new o({callId:t.callId,enableUpdate:t.enableUpdate,customEndpoint:e.customEndpoint}),e.handleAudioEvents(),e.isCalling=!0})},function(t){e.emit("error",t.message)});return Promise.resolve(n&&n.then?n.then(function(){}):void 0)}catch(t){return Promise.reject(t)}},n.stopConversation=function(){var t,e,n,i,a;this.isCalling=!1,null==(t=this.liveClient)||t.close(),null==(e=this.audioContext)||e.suspend(),null==(n=this.audioContext)||n.close(),this.isAudioWorkletSupported()?(null==(a=this.audioNode)||a.disconnect(),this.audioNode=null):this.captureNode&&(this.captureNode.disconnect(),this.captureNode.onaudioprocess=null,this.captureNode=null,this.audioData=[],this.audioDataIndex=0),this.liveClient=null,null==(i=this.stream)||i.getTracks().forEach(function(t){return t.stop()}),this.audioContext=null,this.stream=null},n.handleAudioEvents=function(){var t=this;this.liveClient.on("open",function(){t.emit("conversationStarted")}),this.liveClient.on("audio",function(e){t.playAudio(e)}),this.liveClient.on("disconnect",function(){t.emit("disconnect")}),this.liveClient.on("reconnect",function(){t.emit("reconnect")}),this.liveClient.on("error",function(e){t.emit("error",e),t.isCalling&&t.stopConversation()}),this.liveClient.on("close",function(e,n){t.isCalling&&t.stopConversation(),t.emit("conversationEnded",{code:e,reason:n})}),this.liveClient.on("update",function(e){t.emit("update",e)}),this.liveClient.on("metadata",function(e){t.emit("metadata",e)}),this.liveClient.on("clear",function(){t.isAudioWorkletSupported()?t.audioNode.port.postMessage("clear"):(t.audioData=[],t.audioDataIndex=0,t.isTalking&&(t.isTalking=!1,t.emit("agentStopTalking")))})},n.setupAudioPlayback=function(t,e,n){try{var i=function(t){var e=function(){if(a.isAudioWorkletSupported()){console.log("Audio worklet starting"),a.audioContext.resume();var t=new Blob(['\nclass captureAndPlaybackProcessor extends AudioWorkletProcessor {\n    audioData = [];\n    index = 0;\n    isTalking = false;\n  \n    constructor() {\n      super();\n      //set listener to receive audio data, data is float32 array.\n      this.port.onmessage = (e) => {\n        if (e.data === "clear") {\n          // Clear all buffer.\n          this.audioData = [];\n          this.index = 0;\n          if (this.isTalking) {\n            this.isTalking = false;\n            this.port.postMessage("agent_stop_talking");\n          }\n        } else if (e.data.length > 0) {\n          this.audioData.push(this.convertUint8ToFloat32(e.data));\n          if (!this.isTalking) {\n            this.isTalking = true;\n            this.port.postMessage("agent_start_talking");\n          }\n        }\n      };\n    }\n  \n    convertUint8ToFloat32(array) {\n      const targetArray = new Float32Array(array.byteLength / 2);\n    \n      // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer\n      const sourceDataView = new DataView(array.buffer);\n    \n      // Loop through, get values, and divide by 32,768\n      for (let i = 0; i < targetArray.length; i++) {\n        targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);\n      }\n      return targetArray;\n    }\n  \n    convertFloat32ToUint8(array) {\n      const buffer = new ArrayBuffer(array.length * 2);\n      const view = new DataView(buffer);\n    \n      for (let i = 0; i < array.length; i++) {\n        const value = array[i] * 32768;\n        view.setInt16(i * 2, value, true); // true for little-endian\n      }\n    \n      return new Uint8Array(buffer);\n    }\n  \n    process(inputs, outputs, parameters) {\n      // Capture\n      const input = inputs[0];\n      const inputChannel1 = input[0];\n      const inputChannel2 = input[1];\n      this.port.postMessage(["capture", this.convertFloat32ToUint8(inputChannel1)]);\n  \n      // Playback\n      const output = outputs[0];\n      const outputChannel1 = output[0];\n      const outputChannel2 = output[1];\n      // start playback.\n      for (let i = 0; i < outputChannel1.length; ++i) {\n        if (this.audioData.length > 0) {\n          outputChannel1[i] = this.audioData[0][this.index];\n          outputChannel2[i] = this.audioData[0][this.index];\n          this.index++;\n          if (this.index == this.audioData[0].length) {\n            this.audioData.shift();\n            this.index = 0;\n          }\n        } else {\n          outputChannel1[i] = 0;\n          outputChannel2[i] = 0;\n        }\n      }\n\n      this.port.postMessage(["playback", this.convertFloat32ToUint8(outputChannel1)]);\n      if (!this.audioData.length && this.isTalking) {\n        this.isTalking = false;\n        this.port.postMessage("agent_stop_talking");\n      }\n  \n      return true;\n    }\n  }\n  \n  registerProcessor(\n    "capture-and-playback-processor",\n    captureAndPlaybackProcessor,\n  );\n'],{type:"application/javascript"}),e=URL.createObjectURL(t);return Promise.resolve(a.audioContext.audioWorklet.addModule(e)).then(function(){console.log("Audio worklet loaded"),a.audioNode=new AudioWorkletNode(a.audioContext,"capture-and-playback-processor"),console.log("Audio worklet setup"),a.audioNode.port.onmessage=function(t){var e=t.data;if(Array.isArray(e)){var n,i=e[0];"capture"===i?null==(n=a.liveClient)||n.send(e[1]):"playback"===i&&a.emit("audio",e[1])}else"agent_stop_talking"===e?a.emit("agentStopTalking"):"agent_start_talking"===e&&a.emit("agentStartTalking")},a.audioContext.createMediaStreamSource(a.stream).connect(a.audioNode),a.audioNode.connect(a.audioContext.destination)})}var n=a.audioContext.createMediaStreamSource(a.stream);a.captureNode=a.audioContext.createScriptProcessor(2048,1,1),a.captureNode.onaudioprocess=function(t){if(a.isCalling){var e=r(t.inputBuffer.getChannelData(0));a.liveClient.send(e);for(var n=t.outputBuffer.getChannelData(0),i=0;i<n.length;++i)a.audioData.length>0?(n[i]=a.audioData[0][a.audioDataIndex++],a.audioDataIndex===a.audioData[0].length&&(a.audioData.shift(),a.audioDataIndex=0)):n[i]=0;a.emit("audio",r(n)),!a.audioData.length&&a.isTalking&&(a.isTalking=!1,a.emit("agentStopTalking"))}},n.connect(a.captureNode),a.captureNode.connect(a.audioContext.destination)}();if(e&&e.then)return e.then(function(){})},a=this;a.audioContext=new AudioContext({sampleRate:t}),n&&(a.audioContext.setSinkId(n),console.log("Hello Anne, setting sinkId"));var o=s(function(){function n(t){a.stream=t}return e?n(e):Promise.resolve(navigator.mediaDevices.getUserMedia({audio:{sampleRate:t,echoCancellation:!0,noiseSuppression:!0,channelCount:1}})).then(n)},function(){throw new Error("User didn't give microphone permission")});return Promise.resolve(o&&o.then?o.then(i):i())}catch(t){return Promise.reject(t)}},n.isAudioWorkletSupported=function(){return/Chrome/.test(navigator.userAgent)&&/Google Inc/.test(navigator.vendor)},n.playAudio=function(t){if(this.isAudioWorkletSupported())this.audioNode.port.postMessage(t);else{var e=function(t){for(var e=new Float32Array(t.byteLength/2),n=new DataView(t.buffer),i=0;i<e.length;i++)e[i]=n.getInt16(2*i,!0)/Math.pow(2,15);return e}(t);this.audioData.push(e),this.isTalking||(this.isTalking=!0,this.emit("agentStartTalking"))}},e}(t.EventEmitter);
