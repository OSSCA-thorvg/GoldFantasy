import { Terrain } from '../../engine/src/world-types';
import type { WorldMap } from '../../engine/src/world-map';
import { point, type Point } from '../../engine/src/geometry';
import { f32, clamp } from '../../engine/src/numeric';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { fill, mix, opaque, scale, verticalShade } from './vector-paint';
import { groundColor } from './terrain-painter';
import type { Climate } from './render-types';
export interface PortraitBackdrop {
  ground: Rgb;
  left: Rgb;
  right: Rgb;
  distant: Rgb;
}
const defaultClimate: Climate = { summer: 0, autumn: 0, snow: 0, frost: 0, night: 0 };
function groundTone(terrain: Terrain, shade: number, climate: Climate): Rgb {
  return mix(
    groundColor(terrain, shade, climate),
    [17, 24, 36],
    f32(clamp(climate.night ?? 0, 0, 1) * f32(0.45)),
  );
}
export function portraitBackdrop(terrain?: Terrain, climate?: Climate): PortraitBackdrop;
export function portraitBackdrop(map: WorldMap, position: Point, climate: Climate): PortraitBackdrop;
export function portraitBackdrop(
  first: Terrain | WorldMap = Terrain.Grass,
  second: Climate | Point = defaultClimate,
  third?: Climate,
): PortraitBackdrop {
  if (typeof first === 'number') {
    if ('x' in second) throw new TypeError('A terrain portrait requires a climate.');
    const climate = second;
    return {
      ground: groundTone(first, 1, climate),
      left: groundTone(first, 2, climate),
      right: groundTone(first, 0, climate),
      distant: groundTone(first, 1, climate),
    };
  }
  if (!('x' in second) || !third) throw new TypeError('A map portrait requires a position and climate.');
  const map = first,
    position = second,
    climate = third,
    sample = (p: Point) => {
      const tile = map.cell(p);
      return groundTone(map.terrainAt(p), tile ? tile.shade : 1, climate);
    },
    ground = sample(position),
    center = point(f32(Math.floor(position.x) + f32(0.5)), f32(Math.floor(position.y) + f32(0.5))),
    left = sample(point(f32(center.x - 2), f32(center.y + 2))),
    right = sample(point(f32(center.x + 2), f32(center.y - 2))),
    distant = sample(point(f32(center.x - 2), f32(center.y - 2)));
  return {
    ground,
    left: mix(ground, left, f32(0.65)),
    right: mix(ground, right, f32(0.65)),
    distant: mix(ground, distant, f32(0.5)),
  };
}
export function portraitBackground(backdrop: PortraitBackdrop, width: number, height: number): SceneNode {
  const scene = new SceneNode(),
    ground = new ShapeNode().appendRect(0, 0, width, height);
  verticalShade(ground, backdrop.distant, 0, height, f32(1.48), f32(0.8));
  scene.add(ground);
  const left = new ShapeNode()
    .moveTo(0, f32(height * f32(0.48)))
    .cubicTo(
      f32(width * f32(0.18)),
      f32(height * f32(0.36)),
      f32(width * f32(0.38)),
      f32(height * f32(0.6)),
      width,
      f32(height * f32(0.71)),
    )
    .lineTo(width, height)
    .lineTo(0, height)
    .close();
  fill(left, opaque(scale(backdrop.left, f32(1.13))));
  scene.add(left);
  const right = new ShapeNode()
    .moveTo(width, f32(height * f32(0.49)))
    .cubicTo(
      f32(width * f32(0.76)),
      f32(height * f32(0.37)),
      f32(width * f32(0.56)),
      f32(height * f32(0.6)),
      0,
      f32(height * f32(0.77)),
    )
    .lineTo(0, height)
    .lineTo(width, height)
    .close();
  fill(right, opaque(backdrop.right));
  scene.add(right);
  const near = new ShapeNode()
    .moveTo(0, f32(height * f32(0.86)))
    .cubicTo(
      f32(width * f32(0.3)),
      f32(height * f32(0.72)),
      f32(width * f32(0.68)),
      f32(height * f32(0.91)),
      width,
      f32(height * f32(0.8)),
    )
    .lineTo(width, height)
    .lineTo(0, height)
    .close();
  fill(near, opaque(backdrop.ground));
  scene.add(near);
  return scene;
}
