import { Rect, rgba, type Context } from '../../../../packages/native-ui/src';
import type { GameCommandApp } from './game-commands';
import { selectionReferences } from './selection-targets';
import { hoveredTarget, worldTarget } from './world-targets';
import { Tool } from '../../../../packages/engine/src/game-tools';
import type {
  WorldObjectRef,
  SelectionGeometry,
} from '../../../../packages/native-renderer/src/world-picking-types';
import { worldNameplateBounds, paintWorldNameplate } from './world-nameplate';

/** Emphasize the ground contact or actual road course without enclosing the artwork in a box. */
export function paintSelection(
  context: Context,
  key: string,
  geometry: SelectionGeometry,
  kind: WorldObjectRef['kind'],
  hover = false,
): void {
  const paths = geometry.paths ?? (geometry.path ? [geometry.path] : []);
  if (kind === 'road' && !paths.length) return;
  const opacity = Math.max(0, Math.min(255, geometry.opacity));
  if (!opacity) return;
  for (const [layer, width, color] of [
    ['under', 3.5, [28, 24, 20, Math.round(opacity * 0.85)]],
    ['edge', 1.5, hover ? ([143, 205, 225, opacity] as const) : ([240, 210, 120, opacity] as const)],
  ] as const) {
    context.paint(JSON.stringify(['selection-ground', key, layer, geometry, hover]), () => {
      const shape = new context.tvg.Shape().fill(0, 0, 0, 0);
      if (paths.length) {
        for (const path of paths)
          if (path.length > 1) {
            shape.moveTo(path[0].x, path[0].y);
            for (const p of path.slice(1)) shape.lineTo(p.x, p.y);
          }
      } else if (kind === 'field' && geometry.groundOutline?.length) {
        const outline = geometry.groundOutline;
        shape.moveTo(outline[0].x, outline[0].y);
        for (const p of outline.slice(1)) shape.lineTo(p.x, p.y);
        shape.close();
      } else {
        const outline = geometry.groundOutline;
        const ellipse =
          geometry.ellipse ??
          (outline?.length
            ? {
                rx: Math.max(...outline.map((p) => Math.abs(p.x - geometry.foot.x))) + 3,
                ry: Math.max(...outline.map((p) => Math.abs(p.y - geometry.foot.y))) + 2,
              }
            : { rx: 8, ry: 4 });
        shape.appendCircle(
          geometry.foot.x,
          geometry.foot.y,
          Math.max(4, ellipse.rx),
          Math.max(2, ellipse.ry),
        );
      }
      return shape.stroke({
        width,
        color: [...color],
        cap: context.tvg.StrokeCap.Round,
        join: context.tvg.StrokeJoin.Round,
      });
    });
  }
}

/** Selection is exclusive with hover feedback; labels use the same plate as dungeons. */
export function objectSelectionOverlay(app: GameCommandApp): void {
  const selected = selectionReferences(app);
  const refs = selected.length
    ? selected
    : app.tool === Tool.Select && !app.boxFrom && !app.panFrom
      ? [hoveredTarget(app)].filter((ref): ref is WorldObjectRef => !!ref)
      : [];
  const hover = selected.length === 0,
    occupied: Rect[] = [];
  for (const ref of refs) {
    const target = worldTarget(app, ref);
    if (!target) continue;
    const g = target.geometry;
    paintSelection(app.context, target.key, g, ref.kind, hover);
    const r = worldNameplateBounds(app.context, target.name, g.labelAnchor.x, g.labelAnchor.y - 7, 1.25);
    r.w = Math.min(180, app.viewWidth - 8, r.w);
    r.x = Math.max(4, Math.min(app.viewWidth - r.w - 4, g.labelAnchor.x - r.w / 2));
    r.y = Math.max(4, r.y);
    while (
      occupied.some(
        (other) =>
          r.x < other.x + other.w && r.x + r.w > other.x && r.y < other.y + other.h && r.y + r.h > other.y,
      ) &&
      r.y > 25
    )
      r.y -= 20;
    occupied.push(r);
    paintWorldNameplate(
      app.context,
      app.context.elideText(target.name, r.w - 15, 10, true),
      r,
      hover ? rgba(143, 205, 225) : undefined,
    );
  }
}
