import { SceneNode, ShapeNode, type Command, type Rgba } from './paint';

export interface SelectionBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const selectionStyle = {
  gold: [240, 210, 120, 255] as Rgba,
  dark: [28, 24, 20, 230] as Rgba,
  width: 1.5,
  underWidth: 3.5,
  cornerLength: 6,
  padding: 4,
  minimumExtent: 18,
} as const;

/** Padded bounds include a minimum screen-space extent at distant camera zooms. */
export function selectionFrame(bounds: SelectionBounds): SelectionBounds {
  const padding = selectionStyle.padding,
    width = Math.max(selectionStyle.minimumExtent, bounds.w + padding * 2),
    height = Math.max(selectionStyle.minimumExtent, bounds.h + padding * 2),
    left = bounds.x + (bounds.w - width) / 2,
    top = bounds.y + (bounds.h - height) / 2;
  return { x: left, y: top, w: width, h: height };
}

/** Screen-space corners stay legible without filling or hiding the selected artwork. */
export function selectionCorners(bounds: SelectionBounds): Command[] {
  const frame = selectionFrame(bounds),
    left = frame.x,
    right = left + frame.w,
    top = frame.y,
    bottom = top + frame.h,
    arm = selectionStyle.cornerLength;
  return [
    ['M', left, top + arm],
    ['L', left, top],
    ['L', left + arm, top],
    ['M', right - arm, top],
    ['L', right, top],
    ['L', right, top + arm],
    ['M', left, bottom - arm],
    ['L', left, bottom],
    ['L', left + arm, bottom],
    ['M', right - arm, bottom],
    ['L', right, bottom],
    ['L', right, bottom - arm],
  ];
}

/** One retained marker per visible selection; geometry is expressed in logical screen pixels. */
export class SelectionMarker extends SceneNode {
  readonly under = new ShapeNode()
    .strokeFill(...selectionStyle.dark)
    .strokeWidth(selectionStyle.underWidth)
    .strokeCap('round')
    .strokeJoin('round');
  readonly edge = new ShapeNode()
    .strokeFill(...selectionStyle.gold)
    .strokeWidth(selectionStyle.width)
    .strokeCap('round')
    .strokeJoin('round');
  constructor() {
    super();
    this.add(this.under).add(this.edge);
  }
  update(bounds: SelectionBounds, opacity = 255): void {
    const commands = selectionCorners(bounds);
    for (const shape of [this.under, this.edge]) {
      shape.reset();
      for (const command of commands) {
        if (command[0] === 'M') shape.moveTo(command[1], command[2]);
        else if (command[0] === 'L') shape.lineTo(command[1], command[2]);
      }
    }
    this.opacity(opacity);
  }
}
