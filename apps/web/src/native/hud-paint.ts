import type { Paint } from '@thorvg/webcanvas';
import type { Context } from '../../../../packages/native-ui/src';
import type { PaintNode } from '../../../../packages/native-renderer/src/paint';
import { WebCanvasAdapter } from '../../../../packages/native-renderer/src/webcanvas-adapter';
/** Transfer an owned native vector tree into Context's retained UI lifetime. */
export function hudPaint(context: Context, node: PaintNode): Paint {
  const adapter = new WebCanvasAdapter(context.tvg);
  try {
    return adapter.sync(node).duplicate();
  } finally {
    adapter.dispose();
  }
}
