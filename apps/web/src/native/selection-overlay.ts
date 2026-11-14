import { Rect, rgba } from '../../../../packages/native-ui/src';
import type { GameCommandApp } from './game-commands';
import { selectionReferences } from './selection-targets';
import { hoveredTarget, worldTarget, targetKey } from './world-targets';
import { Tool } from '../../../../packages/engine/src/game-tools';
import type {
  WorldObjectRef,
  GroundSelectionMarker,
} from '../../../../packages/native-renderer/src/world-picking-types';
import { nameplatePlace, paintWorldNameplate } from './world-nameplate';

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
    const g = target.geometry,
      dock = app.dockBounds,
      center = g.bounds.x + g.bounds.w / 2,
      // The name sits under the target, where no health bar or mark is; the bottom panel is its floor.
      floor = dock && dock.h > 0 && center > dock.x - 90 && center < dock.x + dock.w + 90 ? dock.y : app.viewHeight,
      { bounds: r, below } = nameplatePlace(app.context, target.name, g, app.viewWidth, floor, 1.25),
      taken = () =>
        occupied.some(
          (other) =>
            r.x < other.x + other.w && r.x + r.w > other.x && r.y < other.y + other.h && r.y + r.h > other.y,
        );
    // Plates of neighbours stack away from the targets rather than over one another.
    if (below) while (taken() && r.y + r.h + 20 <= floor - 4) r.y += 20;
    else while (taken() && r.y > 25) r.y -= 20;
    occupied.push(r);
    paintWorldNameplate(
      app.context,
      app.context.elideText(target.name, r.w - 14, 10, true),
      r,
      hover ? rgba(143, 205, 225) : undefined,
    );
  }
  app.renderer.setGroundSelection(markers);
}
