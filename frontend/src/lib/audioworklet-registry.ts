/**
 * Registry for AudioWorklet nodes, keyed by AudioContext.
 *
 * Any module using `audioContext.audioWorklet.addModule()` should
 * register the worklet here to avoid duplicate registrations.
 */

export interface WorkletGraph {
  node?: AudioWorkletNode;
  handlers: Array<(this: MessagePort, ev: MessageEvent) => void>;
}

export const registeredWorklets: Map<
  AudioContext,
  Record<string, WorkletGraph>
> = new Map();

/**
 * Create a Blob URL from worklet source string that can be loaded
 * via `audioContext.audioWorklet.addModule()`.
 */
export function createWorkletFromSrc(
  workletName: string,
  workletSrc: string,
): string {
  const script: Blob = new Blob(
    [`registerProcessor("${workletName}", ${workletSrc})`],
    { type: "application/javascript" },
  );
  return URL.createObjectURL(script);
}
