// The light each world beyond a gate shows through its open gate.
import { World } from '../../engine/src/world-types';
import type { Rgb } from './paint';
/** What shows through an open gate: the light of the world behind it. */
export function worldGlimpse(world: World): Rgb {
  switch (world) {
    case World.Asgard:
      return [150, 112, 34];
    case World.Vanaheim:
      return [70, 112, 50];
    case World.Alfheim:
      return [132, 150, 112];
    case World.Jotunheim:
      return [82, 118, 150];
    case World.Svartalfheim:
      return [30, 112, 104];
    case World.Niflheim:
      return [120, 136, 160];
    case World.Muspelheim:
      return [170, 64, 16];
    case World.Helheim:
      return [74, 60, 96];
    default:
      return [120, 100, 150];
  }
}
