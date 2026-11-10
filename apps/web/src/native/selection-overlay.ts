import { Rect, Align, rgba, type Context } from '../../../../packages/native-ui/src';
import {
  selectionCorners,
  selectionStyle,
  type SelectionBounds,
} from '../../../../packages/native-renderer/src/selection-marker';
import type { GameCommandApp } from './game-commands';
import { selectionTargets } from './selection-targets';
import { hoveredTarget, worldTarget, targetKey, type WorldObjectRef } from './world-targets';
import { Tool } from '../../../../packages/engine/src/game-tools';

/** World feedback belongs above object art and below speech, menus and modal UI. */
export function paintSelection(context: Context, key: string, bounds: SelectionBounds, hover = false): void {
  const corners = selectionCorners(bounds);
  for (const [layer, width, color] of [
    ['under', selectionStyle.underWidth, selectionStyle.dark],
    ['edge', selectionStyle.width, hover ? ([143, 205, 225, 255] as const) : selectionStyle.gold],
  ] as const) {
    context.paint(JSON.stringify(['selection', key, layer, bounds, hover]), () => {
      const shape = new context.tvg.Shape().fill(0, 0, 0, 0);
      for (const command of corners) {
        if (command[0] === 'M') shape.moveTo(command[1], command[2]);
        else if (command[0] === 'L') shape.lineTo(command[1], command[2]);
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

export function objectSelectionOverlay(app: GameCommandApp): void {
  const selected = selectionTargets(app),
    seen = new Set(selected.map((t) => t.key)),
    labels: { name: string; bounds: SelectionBounds; hover: boolean }[] = [];
  for (const target of selected) paintSelection(app.context, target.key, target.bounds);
  const refs: WorldObjectRef[] = [
    ...app.chosen.map((id) => ({ kind: 'person' as const, id })),
    ...(app.selectedObjects ?? []),
  ];
  if (app.selected >= 0) refs.push({ kind: 'building', id: app.selected });
  if (app.selectedTree >= 0) refs.push({ kind: 'tree', id: app.selectedTree });
  if (app.selectedRock >= 0) refs.push({ kind: 'rock', id: app.selectedRock });
  if (app.selectedAnimal >= 0) refs.push({ kind: 'animal', id: app.selectedAnimal });
  if (app.selectedDungeon >= 0) refs.push({ kind: 'dungeon', id: app.selectedDungeon });
  for (const ref of refs) {
    const target = worldTarget(app, ref);
    if (!target) continue;
    if (!seen.has(target.key) && ref.kind !== 'person')
      paintSelection(app.context, target.key, target.bounds);
    seen.add(target.key);
    labels.push({ name: target.name, bounds: target.bounds, hover: false });
  }
  const hover = app.tool === Tool.Select && !app.boxFrom && !app.panFrom ? hoveredTarget(app) : null;
  if (hover && !seen.has(targetKey(hover))) {
    const target = worldTarget(app, hover);
    if (target) {
      paintSelection(app.context, target.key, target.bounds, true);
      labels.push({ name: target.name, bounds: target.bounds, hover: true });
    }
  }
  const occupied: Rect[] = [];
  for (const label of labels) {
    const width = Math.min(180, app.context.textWidth(label.name, 11, true) + 14),
      b = label.bounds;
    const r = new Rect(
      Math.max(4, Math.min(app.viewWidth - width - 4, b.x + b.w / 2 - width / 2)),
      Math.max(4, b.y - 28),
      width,
      21,
    );
    while (
      occupied.some(
        (other) =>
          r.x < other.x + other.w && r.x + r.w > other.x && r.y < other.y + other.h && r.y + r.h > other.y,
      ) &&
      r.y > 25
    )
      r.y -= 23;
    occupied.push(r);
    app.context.rect(r, rgba(19, 25, 24, 224), 3);
    app.context.text(
      r,
      label.name,
      label.hover ? rgba(143, 205, 225) : rgba(240, 210, 120),
      11,
      true,
      Align.Center,
    );
  }
}
