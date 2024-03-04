import { EventEmitter } from "eventemitter3";
import WebSocket from "isomorphic-ws";

const baseEndpoint = "wss://api.retellai.com/audio-websocket/";

export interface AudioWsConfig {
  callId: string;
  enableUpdate?: boolean;
  customEndpoint?: string;
}

export class AudioWsClient extends EventEmitter {
  private ws: WebSocket;
  private pingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private wasDisconnected: boolean = false;
  private pingIntervalTime: number = 5000;

  constructor(audioWsConfig: AudioWsConfig) {
    super();

    let endpoint =
      (audioWsConfig.customEndpoint || baseEndpoint) + audioWsConfig.callId;

    if (audioWsConfig.enableUpdate) {
      endpoint += "?enable_update=true";
    }

    this.ws = new WebSocket(endpoint);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.emit("open");
      this.startPingPong();
    };

    this.ws.onmessage = (event) => {

      if (typeof event.data === "string") {
        if (event.data === "pong") {
          if (this.wasDisconnected) {
            this.emit("reconnect");
            this.wasDisconnected = false;
          }
          this.adjustPingFrequency(5000); // Reset ping frequency to 5 seconds
        }
        else if (event.data === "clear") {
          this.emit("clear");
        } else {
          // Handle json update data
          try {
            const update = JSON.parse(event.data);
            this.emit("update", update);
          } catch (err) {
            console.log(err);
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Handle binary data (ArrayBuffer)
        const audio = new Uint8Array(event.data);
        this.emit("audio", audio);
      } else {
        console.log("error", "Got unknown message from server.");
      }
    };
    this.ws.onclose = (event) => {
      this.stopPingPong();
      this.emit("close", event.code, event.reason);
    };
    this.ws.onerror = (event) => {
      this.stopPingPong();
      this.emit("error", event.error);
    };
  }

  startPingPong() {
    this.pingInterval = setInterval(() => this.sendPing(), this.pingIntervalTime);
    this.resetPingTimeout();
  }

  sendPing() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send("ping");
    }
  }

  adjustPingFrequency(newInterval: number) {
    if (this.pingIntervalTime !== newInterval) {
      if (this.pingInterval != null) {
        clearInterval(this.pingInterval);
      }
      this.pingIntervalTime = newInterval;
      this.startPingPong();
    }
  }

  resetPingTimeout() {
    if (this.pingTimeout != null) {
      clearTimeout(this.pingTimeout);
    }
    this.pingTimeout = setTimeout(() => {
      if (this.pingIntervalTime === 5000) {
        this.adjustPingFrequency(1000);
        this.pingTimeout = setTimeout(() => {
          this.emit("disconnect");
          this.wasDisconnected = true;
        }, 3000);
      }
    }, this.pingIntervalTime);
  }

  stopPingPong() {
    if (this.pingInterval != null) {
      clearInterval(this.pingInterval);
    }
    if (this.pingTimeout != null) {
      clearTimeout(this.pingTimeout);
    }
  }

  send(audio: Uint8Array) {
    if (this.ws.readyState === 1) {
      this.ws.send(audio);
    }
  }

  close() {
    this.ws.close();
  }
}

export function convertUint8ToFloat32(array: Uint8Array): Float32Array {
  const targetArray = new Float32Array(array.byteLength / 2);

  // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer
  const sourceDataView = new DataView(array.buffer);

  // Loop through, get values, and divide by 32,768
  for (let i = 0; i < targetArray.length; i++) {
    targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);
  }
  return targetArray;
}

export function convertFloat32ToUint8(array: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < array.length; i++) {
    const value = (array[i] as number) * 32768;
    view.setInt16(i * 2, value, true); // true for little-endian
  }

  return new Uint8Array(buffer);
}
