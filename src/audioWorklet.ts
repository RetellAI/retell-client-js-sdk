export const workletCode = `
class captureAndPlaybackProcessor extends AudioWorkletProcessor {
    audioData = [];
    index = 0;
  
    constructor() {
      super();
      //set listener to receive audio data, data is float32 array.
      this.port.onmessage = (e) => {
        if (e.data === "clear") {
          // Clear all buffer.
          this.audioData = [];
          this.index = 0;
        } else if (e.data.length > 0) {
          this.audioData.push(this.convertUint8ToFloat32(e.data));
        }
      };
    }
  
    convertUint8ToFloat32(array) {
      const targetArray = new Float32Array(array.byteLength / 2);
    
      // A DataView is used to read our 16-bit little-endian samples out of the Uint8Array buffer
      const sourceDataView = new DataView(array.buffer);
    
      // Loop through, get values, and divide by 32,768
      for (let i = 0; i < targetArray.length; i++) {
        targetArray[i] = sourceDataView.getInt16(i * 2, true) / Math.pow(2, 16 - 1);
      }
      return targetArray;
    }
  
    convertFloat32ToUint8(array) {
      const buffer = new ArrayBuffer(array.length * 2);
      const view = new DataView(buffer);
    
      for (let i = 0; i < array.length; i++) {
        const value = array[i] * 32768;
        view.setInt16(i * 2, value, true); // true for little-endian
      }
    
      return new Uint8Array(buffer);
    }
  
    process(inputs, outputs, parameters) {
      // Capture
      const input = inputs[0];
      const inputChannel1 = input[0];
      this.port.postMessage(this.convertFloat32ToUint8(inputChannel1));
  
      // Playback
      const output = outputs[0];
      const outputChannel1 = output[0];
      // start playback.
      for (let i = 0; i < outputChannel1.length; ++i) {
        if (this.audioData.length > 0) {
          outputChannel1[i] = this.audioData[0][this.index];
          this.index++;
          if (this.index == this.audioData[0].length) {
            this.audioData.shift();
            this.index = 0;
          }
        } else {
          outputChannel1[i] = 0;
        }
      }
  
      return true;
    }
  }
  
  registerProcessor(
    "capture-and-playback-processor",
    captureAndPlaybackProcessor,
  );
`;
