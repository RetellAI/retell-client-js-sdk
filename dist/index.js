var e=require("retell-sdk"),t=require("retell-sdk/models/components/calldetail");function n(e,t){try{var n=e()}catch(e){return t(e)}return n&&n.then?n.then(void 0,t):n}exports.RetellClientSdk=/*#__PURE__*/function(){function o(t){this.retell=void 0,this.liveClient=null,this.audioContext=null,this.isCalling=!1,this.stream=null,this.captureNode=null,this.audioData=[],this.audioDataIndex=0,this.eventListeners={onConversationStarted:[],onConversationEnded:[],onError:[]},this.retell=new e.RetellClient({apiKey:t})}var i=o.prototype;return i.startConversation=function(o){var i=o.agentId,r=o.sampleRate,a=void 0===r?22050:r,s=o.audioEncoding,l=void 0===s?t.AudioEncoding.S16le:s,u=o.customStream,d=void 0===u?null:u;try{var c=this;return Promise.resolve(n(function(){return Promise.resolve(c.setupAudio(a,d)).then(function(){return Promise.resolve(c.retell.registerCall({agentId:i,audioWebsocketProtocol:t.AudioWebsocketProtocol.Web,audioEncoding:l,sampleRate:a})).then(function(t){if(!t||!t.callDetail)throw new Error("Register call failed");c.liveClient=new e.AudioWsClient(t.callDetail.callId),c.handleAudioEvents(),c.isCalling=!0,c.audioContext.resume(),c.triggerEvent("onConversationStarted")})})},function(e){c.triggerEvent("onError",e.message)}))}catch(e){return Promise.reject(e)}},i.stopConversation=function(){var e,t,n;this.isCalling=!1,null==(e=this.liveClient)||e.close(),null==(t=this.audioContext)||t.suspend(),this.captureNode&&(this.captureNode.disconnect(),this.captureNode.onaudioprocess=null),this.audioContext&&this.audioContext.close(),null==(n=this.stream)||n.getTracks().forEach(function(e){return e.stop()}),this.liveClient=null,this.audioContext=null,this.stream=null,this.captureNode=null,this.audioData=[],this.audioDataIndex=0,this.triggerEvent("onConversationEnded")},i.on=function(e,t){this.eventListeners[e]&&this.eventListeners[e].push(t)},i.setupAudio=function(t,o){void 0===o&&(o=null);try{var i=function(t){var n=r.audioContext.createMediaStreamSource(r.stream);r.captureNode=r.audioContext.createScriptProcessor(2048,1,1),r.captureNode.onaudioprocess=function(t){if(r.isCalling){var n=t.inputBuffer.getChannelData(0),o=e.convertFloat32ToUint8(n);r.liveClient.send(o);for(var i=t.outputBuffer.getChannelData(0),a=0;a<i.length;++a)r.audioData.length>0?(i[a]=r.audioData[0][r.audioDataIndex++],r.audioDataIndex===r.audioData[0].length&&(r.audioData.shift(),r.audioDataIndex=0)):i[a]=0}},n.connect(r.captureNode),r.captureNode.connect(r.audioContext.destination)},r=this;r.audioContext=new AudioContext({sampleRate:t});var a=n(function(){function e(e){r.stream=e}return o?e(o):Promise.resolve(navigator.mediaDevices.getUserMedia({audio:{sampleRate:t,echoCancellation:!0,noiseSuppression:!0,channelCount:1}})).then(e)},function(){throw new Error("User didn't give microphone permission")});return Promise.resolve(a&&a.then?a.then(i):i())}catch(e){return Promise.reject(e)}},i.handleAudioEvents=function(){var t=this;this.liveClient.on("audio",function(n){var o=e.convertUint8ToFloat32(n);t.audioData.push(o)}),this.liveClient.on("error",function(e){t.triggerEvent("onError",e),t.stopConversation()}),this.liveClient.on("close",function(e,n){t.stopConversation(),t.triggerEvent("onConversationEnded",{code:e,reason:n})})},i.triggerEvent=function(e,t){this.eventListeners[e]&&this.eventListeners[e].forEach(function(e){return e(t)})},o}();
