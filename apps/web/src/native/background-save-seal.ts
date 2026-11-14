import { sealSave } from '../../../../packages/engine/src/save-archive';

let worker: Worker | undefined,
  unavailable = false,
  nextId = 0;
const waiting = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
/** Checksums and encodes a save payload on a worker, so an autosave costs the frame only its serialization. */
export function sealSaveInBackground(payload: Uint8Array): Promise<string> {
  if (!worker && !unavailable) {
    try {
      worker = new Worker(new URL('./save-seal-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<{ id: number; text?: string; error?: string }>) => {
        const request = waiting.get(data.id);
        waiting.delete(data.id);
        if (data.text !== undefined) request?.resolve(data.text);
        else request?.reject(new Error(data.error ?? 'Could not seal the save.'));
      };
      worker.onerror = () => {
        unavailable = true;
        worker = undefined;
        for (const request of waiting.values()) request.reject(new Error('The save worker stopped.'));
        waiting.clear();
      };
    } catch {
      unavailable = true;
    }
  }
  if (!worker) return Promise.resolve().then(() => sealSave(payload));
  const id = nextId++,
    // The archive buffer is reused by the next save; the worker gets its own copy.
    copy = payload.slice();
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, payload: copy }, [copy.buffer]);
  });
}
