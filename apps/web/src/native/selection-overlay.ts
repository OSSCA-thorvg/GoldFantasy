import type { Context } from '../../../../packages/native-ui/src';
import {
  selectionCorners,
  selectionStyle,
  type SelectionBounds,
} from '../../../../packages/native-renderer/src/selection-marker';
import type { GameCommandApp } from './game-commands';
import { selectionTargets } from './selection-targets';

/** World feedback belongs above object art and below speech, menus and modal UI. */
export function paintSelection(context: Context, key: string, bounds: SelectionBounds): void {
  const corners = selectionCorners(bounds);
  for (const [layer, width, color] of [
    ['under', selectionStyle.underWidth, selectionStyle.dark],
    ['edge', selectionStyle.width, selectionStyle.gold],
  ] as const) {
    context.paint(JSON.stringify(['selection', key, layer, bounds]), () => {
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
  for (const target of selectionTargets(app)) paintSelection(app.context, target.key, target.bounds);
}
