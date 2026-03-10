/**
 * Audio recording worklet processor source.
 *
 * Exported as a string so it can be loaded via Blob URL with
 * `audioContext.audioWorklet.addModule()`. The worklet captures
 * Float32 mic samples, converts to Int16 PCM, and posts the
 * buffer back to the main thread every 2048 samples (~128ms at 16kHz).
 */

const AudioRecordingWorklet: string = `
class AudioProcessingWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(2048);
    this.bufferWriteIndex = 0;
  }

  /**
   * @param {Float32Array[][]} inputs [input#][channel#][sample#]
   */
  process(inputs) {
    if (inputs[0].length) {
      const channel0 = inputs[0][0];
      this.processChunk(channel0);
    }
    return true;
  }

  sendAndClearBuffer() {
    this.port.postMessage({
      event: "chunk",
      data: {
        int16arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer,
      },
    });
    this.bufferWriteIndex = 0;
  }

  processChunk(float32Array) {
    for (let i = 0; i < float32Array.length; i++) {
      // Convert float32 [-1, 1] to int16 [-32768, 32767]
      this.buffer[this.bufferWriteIndex++] = float32Array[i] * 0x7FFF;
      if (this.bufferWriteIndex >= this.buffer.length) {
        this.sendAndClearBuffer();
      }
    }
  }
}
`;

export default AudioRecordingWorklet;
