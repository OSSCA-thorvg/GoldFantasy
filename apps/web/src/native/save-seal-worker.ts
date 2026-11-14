import { sealSave } from '../../../../packages/engine/src/save-archive';

self.onmessage = ({ data }: MessageEvent<{ id: number; payload: Uint8Array }>) => {
  try {
    self.postMessage({ id: data.id, text: sealSave(data.payload) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
