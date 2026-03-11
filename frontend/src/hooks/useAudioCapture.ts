/**
 * useAudioCapture — captures microphone audio as base64 PCM16 chunks.
 *
 * Uses an AudioWorklet at 16kHz sample rate for low-latency capture.
 * Includes a volume meter worklet for mic activity visualization.
 */

import { useState, useRef, useCallback } from "react";
import AudioRecordingWorklet from "../lib/worklets/audio-processing";
import VolMeterWorklet from "../lib/worklets/vol-meter";
import { createWorkletFromSrc } from "../lib/audioworklet-registry";

export type MicPermissionState = "prompt" | "granted" | "denied" | "error";

interface UseAudioCaptureOptions {
  onAudioData: (base64Pcm: string) => void;
  onVolume?: (volume: number) => void;
}

interface UseAudioCaptureReturn {
  isCapturing: boolean;
  permissionState: MicPermissionState;
  volume: number;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes: Uint8Array = new Uint8Array(buffer);
  let binary: string = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function useAudioCapture({
  onAudioData,
  onVolume,
}: UseAudioCaptureOptions): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [permissionState, setPermissionState] =
    useState<MicPermissionState>("prompt");
  const [volume, setVolume] = useState<number>(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordingWorkletRef = useRef<AudioWorkletNode | null>(null);
  const vuWorkletRef = useRef<AudioWorkletNode | null>(null);

  const startCapture = useCallback(async (): Promise<void> => {
    if (isCapturing) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionState("error");
      return;
    }

    try {
      const stream: MediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });
      streamRef.current = stream;
      setPermissionState("granted");

      const ctx: AudioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const source: MediaStreamAudioSourceNode =
        ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Recording worklet — captures PCM16 chunks
      const recWorkletName: string = "audio-recorder-worklet";
      const recSrc: string = createWorkletFromSrc(
        recWorkletName,
        AudioRecordingWorklet,
      );
      await ctx.audioWorklet.addModule(recSrc);
      const recordingWorklet: AudioWorkletNode = new AudioWorkletNode(
        ctx,
        recWorkletName,
      );
      recordingWorkletRef.current = recordingWorklet;

      recordingWorklet.port.onmessage = (ev: MessageEvent): void => {
        const arrayBuffer: ArrayBuffer | undefined =
          ev.data?.data?.int16arrayBuffer;
        if (arrayBuffer) {
          const base64: string = arrayBufferToBase64(arrayBuffer);
          onAudioData(base64);
        }
      };

      source.connect(recordingWorklet);

      // Volume meter worklet
      const vuWorkletName: string = "vu-meter";
      const vuSrc: string = createWorkletFromSrc(
        vuWorkletName,
        VolMeterWorklet,
      );
      await ctx.audioWorklet.addModule(vuSrc);
      const vuWorklet: AudioWorkletNode = new AudioWorkletNode(
        ctx,
        vuWorkletName,
      );
      vuWorkletRef.current = vuWorklet;

      vuWorklet.port.onmessage = (ev: MessageEvent): void => {
        const vol: number = ev.data?.volume ?? 0;
        setVolume(vol);
        onVolume?.(vol);
      };

      source.connect(vuWorklet);
      setIsCapturing(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermissionState("denied");
      } else {
        setPermissionState("error");
      }
    }
  }, [isCapturing, onAudioData, onVolume]);

  const stopCapture = useCallback((): void => {
    sourceRef.current?.disconnect();

    streamRef.current?.getTracks().forEach((track: MediaStreamTrack) => {
      track.stop();
    });

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
    }

    streamRef.current = null;
    audioContextRef.current = null;
    sourceRef.current = null;
    recordingWorkletRef.current = null;
    vuWorkletRef.current = null;

    setIsCapturing(false);
    setVolume(0);
  }, []);

  return {
    isCapturing,
    permissionState,
    volume,
    startCapture,
    stopCapture,
  };
}
