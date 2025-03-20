import{EventEmitter as t}from"eventemitter3";import{Room as e,RoomEvent as n,Track as o,RemoteAudioTrack as i,createAudioAnalyser as a}from"livekit-client";function r(t,e){return r=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,e){return t.__proto__=e,t},r(t,e)}var c=new TextDecoder,s=/*#__PURE__*/function(t){var s,l;function u(){var e;return(e=t.call(this)||this).room=void 0,e.connected=!1,e.isAgentTalking=!1,e.analyzerComponent=void 0,e.captureAudioFrame=void 0,e}l=t,(s=u).prototype=Object.create(l.prototype),s.prototype.constructor=s,r(s,l);var d=u.prototype;return d.startCall=function(t){try{var n=this,o=function(o,i){try{var a=(n.room=new e({audioCaptureDefaults:{autoGainControl:!0,echoCancellation:!0,noiseSuppression:!0,channelCount:1,deviceId:t.captureDeviceId,sampleRate:t.sampleRate},audioOutput:{deviceId:t.playbackDeviceId}}),n.handleRoomEvents(),n.handleAudioEvents(t),n.handleDataEvents(),Promise.resolve(n.room.connect("wss://retell-ai-4ihahnq7.livekit.cloud",t.accessToken)).then(function(){console.log("connected to room",n.room.name),n.room.localParticipant.setMicrophoneEnabled(!0),n.connected=!0,n.emit("call_started")}))}catch(t){return i(t)}return a&&a.then?a.then(void 0,i):a}(0,function(t){n.emit("error","Error starting call"),console.error("Error starting call",t),n.stopCall()});return Promise.resolve(o&&o.then?o.then(function(){}):void 0)}catch(t){return Promise.reject(t)}},d.startAudioPlayback=function(){try{return Promise.resolve(this.room.startAudio()).then(function(){})}catch(t){return Promise.reject(t)}},d.stopCall=function(){var t;this.connected&&(this.connected=!1,this.emit("call_ended"),null==(t=this.room)||t.disconnect(),this.isAgentTalking=!1,delete this.room,this.analyzerComponent&&(this.analyzerComponent.cleanup(),delete this.analyzerComponent),this.captureAudioFrame&&(window.cancelAnimationFrame(this.captureAudioFrame),delete this.captureAudioFrame))},d.mute=function(){this.connected&&this.room.localParticipant.setMicrophoneEnabled(!1)},d.unmute=function(){this.connected&&this.room.localParticipant.setMicrophoneEnabled(!0)},d.captureAudioSamples=function(){var t=this;if(this.connected&&this.analyzerComponent){var e=new Float32Array(this.analyzerComponent.analyser.fftSize);this.analyzerComponent.analyser.getFloatTimeDomainData(e),this.emit("audio",e),this.captureAudioFrame=window.requestAnimationFrame(function(){return t.captureAudioSamples()})}},d.handleRoomEvents=function(){var t=this;this.room.on(n.ParticipantDisconnected,function(e){"server"===(null==e?void 0:e.identity)&&setTimeout(function(){t.stopCall()},500)}),this.room.on(n.Disconnected,function(){t.stopCall()})},d.handleAudioEvents=function(t){var e=this;this.room.on(n.TrackSubscribed,function(n,r,c){n.kind===o.Kind.Audio&&n instanceof i&&("agent_audio"===r.trackName&&(e.emit("call_ready"),t.emitRawAudioSamples&&(e.analyzerComponent=a(n),e.captureAudioFrame=window.requestAnimationFrame(function(){return e.captureAudioSamples()}))),n.attach())})},d.handleDataEvents=function(){var t=this;this.room.on(n.DataReceived,function(e,n,o,i){try{if("server"!==(null==n?void 0:n.identity))return;var a=c.decode(e),r=JSON.parse(a);"update"===r.event_type?t.emit("update",r):"metadata"===r.event_type?t.emit("metadata",r):"agent_start_talking"===r.event_type?(t.isAgentTalking=!0,t.emit("agent_start_talking")):"agent_stop_talking"===r.event_type?(t.isAgentTalking=!1,t.emit("agent_stop_talking")):"node_transition"===r.event_type&&t.emit("node_transition",r)}catch(t){console.error("Error decoding data received",t)}})},u}(t);export{s as RetellWebClient};
