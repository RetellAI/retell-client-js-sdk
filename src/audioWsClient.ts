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
    };

    this.ws.onmessage = (event) => {
      // Check if the data is a string (text data)
      if (typeof event.data === "string") {
        if (event.data === "clear") {
          this.emit("clear");
        } else {
          // Handle json update data
          try {
            const update = JSON.parse(event.data);
            this.emit("update", update);
          } catch (err) {
            this.emit("error", "Error parsing JSON update from server.");
            this.ws.close(1002, "Error parsing JSON update from server.");
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Handle binary data (ArrayBuffer)
        const audio = new Uint8Array(event.data);
        this.emit("audio", audio);
      } else {
        this.emit("error", "Got unknown message from server.");
        this.ws.close(1002, "Got unknown message from server.");
      }
    };
    this.ws.onclose = (event) => {
      this.emit("close", event.code, event.reason);
    };
    this.ws.onerror = (event) => {
      this.emit("error", event.error);
    };
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
