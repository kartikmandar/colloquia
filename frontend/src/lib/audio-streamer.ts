/**
 * AudioStreamer — schedules PCM16 audio chunks for gapless playback.
 *
 * Adapted from google-gemini/live-api-web-console.
 * Receives base64-encoded PCM16 chunks (24kHz), decodes to Float32,
 * and schedules playback via Web Audio API with a small look-ahead buffer.
 */

import {
  createWorkletFromSrc,
  registeredWorklets,
  type WorkletGraph,
} from "./audioworklet-registry";

export class AudioStreamer {
  private sampleRate: number = 24000;
  private bufferSize: number = 7680;
  private audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private scheduledTime: number = 0;
  private initialBufferTime: number = 0.1; // 100ms initial buffer
  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  public context: AudioContext;
  public onComplete: () => void = () => {};

  constructor(context: AudioContext) {
    this.context = context;
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
  }

  /**
   * Register an AudioWorklet on this streamer's context (e.g. volume meter).
   */
  async addWorklet<T extends (d: MessageEvent) => void>(
    workletName: string,
    workletSrc: string,
    handler: T,
  ): Promise<this> {
    let workletsRecord: Record<string, WorkletGraph> | undefined =
      registeredWorklets.get(this.context);

    if (workletsRecord && workletsRecord[workletName]) {
      workletsRecord[workletName].handlers.push(handler);
      return this;
    }

    if (!workletsRecord) {
      registeredWorklets.set(this.context, {});
      workletsRecord = registeredWorklets.get(this.context)!;
    }

    workletsRecord[workletName] = { handlers: [handler] };

    const src: string = createWorkletFromSrc(workletName, workletSrc);
    await this.context.audioWorklet.addModule(src);
    const worklet: AudioWorkletNode = new AudioWorkletNode(
      this.context,
      workletName,
    );
    workletsRecord[workletName].node = worklet;

    return this;
  }

  /**
   * Convert a Uint8Array of PCM16 little-endian data to Float32 [-1, 1].
   */
  private processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const float32Array: Float32Array = new Float32Array(chunk.length / 2);
    const dataView: DataView = new DataView(chunk.buffer);

    for (let i = 0; i < chunk.length / 2; i++) {
      const int16: number = dataView.getInt16(i * 2, true);
      float32Array[i] = int16 / 32768;
    }
    return float32Array;
  }

  /**
   * Add a PCM16 chunk (Uint8Array) to the playback queue.
   */
  addPCM16(chunk: Uint8Array): void {
    this.isStreamComplete = false;
    let processingBuffer: Float32Array = this.processPCM16Chunk(chunk);

    while (processingBuffer.length >= this.bufferSize) {
      const buffer: Float32Array = processingBuffer.slice(0, this.bufferSize);
      this.audioQueue.push(buffer);
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    if (processingBuffer.length > 0) {
      this.audioQueue.push(processingBuffer);
    }

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      this.scheduleNextBuffer();
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer: AudioBuffer = this.context.createBuffer(
      1,
      audioData.length,
      this.sampleRate,
    );
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer(): void {
    const SCHEDULE_AHEAD_TIME: number = 0.2;

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      const audioData: Float32Array = this.audioQueue.shift()!;
      const audioBuffer: AudioBuffer = this.createAudioBuffer(audioData);
      const source: AudioBufferSourceNode = this.context.createBufferSource();

      if (this.audioQueue.length === 0) {
        if (this.endOfQueueAudioSource) {
          this.endOfQueueAudioSource.onended = null;
        }
        this.endOfQueueAudioSource = source;
        source.onended = (): void => {
          if (
            !this.audioQueue.length &&
            this.endOfQueueAudioSource === source
          ) {
            this.endOfQueueAudioSource = null;
            this.onComplete();
          }
        };
      }

      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const worklets: Record<string, WorkletGraph> | undefined =
        registeredWorklets.get(this.context);

      if (worklets) {
        Object.entries(worklets).forEach(
          ([, graph]: [string, WorkletGraph]) => {
            const { node, handlers } = graph;
            if (node) {
              source.connect(node);
              node.port.onmessage = function (ev: MessageEvent): void {
                handlers.forEach((handler) => {
                  handler.call(node.port, ev);
                });
              };
              node.connect(this.context.destination);
            }
          },
        );
      }

      const startTime: number = Math.max(
        this.scheduledTime,
        this.context.currentTime,
      );
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
    }

    if (this.audioQueue.length === 0) {
      if (this.isStreamComplete) {
        this.isPlaying = false;
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      } else {
        if (!this.checkInterval) {
          this.checkInterval = window.setInterval(() => {
            if (this.audioQueue.length > 0) {
              this.scheduleNextBuffer();
            }
          }, 100) as unknown as number;
        }
      }
    } else {
      const nextCheckTime: number =
        (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(
        () => this.scheduleNextBuffer(),
        Math.max(0, nextCheckTime - 50),
      );
    }
  }

  /**
   * Stop playback immediately, clear queue, ramp gain to zero.
   */
  stop(): void {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.gainNode.gain.linearRampToValueAtTime(
      0,
      this.context.currentTime + 0.1,
    );

    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  /**
   * Resume the audio context and prepare for new audio chunks.
   */
  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.isStreamComplete = false;
    this.scheduledTime = this.context.currentTime + this.initialBufferTime;
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }

  /**
   * Mark the stream as complete (no more chunks expected).
   */
  complete(): void {
    this.isStreamComplete = true;
    this.onComplete();
  }
}
