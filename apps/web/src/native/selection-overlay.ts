import { Rect, rgba } from '../../../../packages/native-ui/src';
import type { GameCommandApp } from './game-commands';
import { selectionReferences } from './selection-targets';
import { hoveredTarget, worldTarget, targetKey } from './world-targets';
import { Tool } from '../../../../packages/engine/src/game-tools';
import type {
  WorldObjectRef,
  GroundSelectionMarker,
} from '../../../../packages/native-renderer/src/world-picking-types';
import { worldNameplateBounds, paintWorldNameplate } from './world-nameplate';

/** Ground feedback belongs beneath world objects; only nameplates are drawn in the HUD. */
export function objectSelectionOverlay(app: GameCommandApp): void {
  const selected = selectionReferences(app);
  const refs = selected.length
    ? selected
    : !app.touchMode && app.tool === Tool.Select && !app.boxFrom && !app.panFrom
      ? [hoveredTarget(app)].filter((ref): ref is WorldObjectRef => !!ref)
      : [];
  const hover = selected.length === 0,
    occupied: Rect[] = [],
    markers: GroundSelectionMarker[] = [];
  for (const ref of refs) {
    const target = worldTarget(app, ref);
    // Ground feedback resolves current model positions even before a new frame is presented.
    markers.push({
      key: targetKey(ref),
      kind: ref.kind,
      hover,
      ...(target ? { geometry: target.geometry } : {}),
    });
    if (!target) continue;
    const g = target.geometry;
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
  app.renderer.setGroundSelection(markers);
}
