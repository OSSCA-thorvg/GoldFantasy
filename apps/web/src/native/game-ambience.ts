// Camera placement and continuous sound levels from native game_app.cpp.
import type { GameInputApp } from './game-input';
import { point, add, scale, distance, unproject, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 as f } from '../../../../packages/engine/src/numeric';
import { Weather } from '../../../../packages/engine/src/climate';
import { Season } from '../../../../packages/engine/src/town-models';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import { isWater } from '../../../../packages/engine/src/world-types';
import { Cue, Sound, Ambience, effectVolume } from '../../../../packages/native-audio/src/sound-types';
export interface GameAmbienceApp extends GameInputApp {
  spatial(cue: Cue, world: Point): Sound;
}
export function cue(this: GameAmbienceApp, sound: Cue): void {
  if (this.cues.length < 32) this.cues.push(new Sound(sound));
}
export function spatial(this: GameAmbienceApp, sound: Cue, world: Point): Sound {
  const at = this.toScreen(world),
    pan = clamp(f(f(at.x - f(this.viewWidth / 2)) / f(this.viewWidth / 2)), -1, 1),
    onScreen = at.x >= 0 && at.x <= this.viewWidth && at.y >= 0 && at.y <= this.viewHeight;
  const middle = unproject(this.camera.x, this.camera.y),
    earshot = f(14 / Math.max(this.camera.zoom, f(0.3))),
    attenuation = f(Math.exp(f(-distance(world, middle) / earshot)));
  return new Sound(sound, onScreen ? f(effectVolume(this.camera.zoom) * attenuation) : 0, pan);
}
export function cueAt(this: GameAmbienceApp, sound: Cue, world: Point): void {
  const placed = this.spatial(sound, world);
  if (placed.gain > f(0.03) && this.cues.length < 32) this.cues.push(placed);
}
export function ambience(this: GameAmbienceApp): Ambience {
  const sky = this.town.climate(),
    mix = new Ambience(),
    wet = sky.weather === Weather.Rain || sky.weather === Weather.Storm;
  mix.rain = wet ? f(Math.pow(clamp(sky.intensity, 0, 1), f(0.75))) : 0;
  mix.wind = sky.wind;
  mix.night = f(sky.night * (sky.temperature > 4 ? 1 : f(0.3)));
  mix.birds = f(f(f(1 - sky.night) * (wet ? f(0.1) : 1)) * (sky.temperature > 3 ? 1 : f(0.2)));
  const middle = unproject(this.camera.x, this.camera.y),
    earshot = f(14 / Math.max(this.camera.zoom, f(0.3)));
  // Work hits are discrete simulation events, synchronized with each visible
  // tool contact. Random ambient hammering would play between those contacts.
  const steps = 10;
  let heard = 0,
    shore = 0,
    shoreX = 0,
    canopy = 0;
  for (let j = -steps; j <= steps; ++j)
    for (let i = -steps; i <= steps; ++i) {
      const weight = f(1 - f(f(Math.hypot(i, j)) / steps)),
        at = add(middle, scale(point(i, j), f(earshot / steps))),
        tile = weight > 0 ? this.town.map().cell(at) : null;
      if (!tile) continue;
      heard = f(heard + weight);
      canopy = f(canopy + f(f(weight * tile.trees) / f(3)));
      if (!isWater(tile.terrain)) continue;
      shore = f(shore + weight);
      shoreX = f(shoreX + f(weight * this.spatial(Cue.Place, at).pan));
    }
  if (heard > 0) {
    mix.water = f(Math.min(1, f(f(f(2.5) * shore) / heard)) * f(1 - sky.frost));
    mix.waterPan = shore > 0 ? f(shoreX / shore) : 0;
    mix.woods = Math.min(1, f(f(2 * canopy) / heard));
  }
  const fire = this.town.camp();
  if (fire && fire.built() && fire.kind === Structure.Camp) {
    mix.fire = Math.max(0, f(1 - f(distance(fire.center, middle) / earshot)));
    mix.firePan = this.spatial(Cue.Place, fire.center).pan;
  }
  mix.music = this.town.bardPlaying() ? 1 : 0;
  mix.raid = this.town.raiding() ? 1 : 0;
  mix.dark = sky.night;
  mix.winter = this.town.calendar().season === Season.Winter ? 1 : 0;
  mix.gloom = wet || sky.weather === Weather.Snow ? 1 : 0;
  const near = clamp(f(f(this.camera.zoom - f(0.3)) / f(0.9)), 0, 1);
  for (const level of ['birds', 'night', 'fire', 'water', 'woods', 'chopping'] as const)
    mix[level] = f(mix[level] * near);
  return mix;
}
