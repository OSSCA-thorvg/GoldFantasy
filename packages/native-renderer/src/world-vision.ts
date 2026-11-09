import { project, point, distance } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { belongsToFaction, isPlayerBuilding } from '../../engine/src/faction';
import { Town } from '../../engine/src/town';
import { WorldMap } from '../../engine/src/world-map';
import { VisibilityRegion } from '../../engine/src/visibility-map';
import { Structure, structureSpec, isHome, isSeat, isLodging } from '../../engine/src/building-catalog';
import { WorldRendererState } from './world-renderer-state';
import { SceneNode, ShapeNode, PictureNode } from './paint';
import { softDisc } from './vector-paint';
import { brightest } from './light-flicker';
import { fitToView } from './world-ground';
export function buildDarkness(s: WorldRendererState, map: WorldMap): void {
  s.darkness.remove();
  const top = project(0, 0),
    right = project(map.width(), 0),
    left = project(0, map.height()),
    bottom = project(map.width(), map.height()),
    dark = new ShapeNode()
      .appendRect(left.x, top.y, f32(right.x - left.x), f32(bottom.y - top.y))
      .fill(4, 6, 22, 170);
  s.darkVeil = dark;
  const lit = new SceneNode();
  s.warmth.remove();
  for (const pool of s.pools) {
    pool.hole = softDisc(pool.rx, [255, 255, 255], Math.trunc(f32(190 * brightest)));
    lit.add(pool.hole);
    if (pool.warmth[0] + pool.warmth[1] + pool.warmth[2] === 0) continue;
    pool.tint = softDisc(f32(pool.rx * f32(0.8)), pool.warmth, 255);
    s.warmth.add(pool.tint);
  }
  dark.mask(lit, 'inverseAlpha');
  s.darkness.add(dark);
  fitToView(s, true);
  s.lastFlicker = -1;
}
export function updateVision(s: WorldRendererState, town: Town): void {
  const map = town.map(),
    first = !s.visibilityPicture;
  let changed = new VisibilityRegion();
  if (first) {
    s.exploredVisibility.reset(map.width(), map.height());
    s.currentVisibility.reset(map.width(), map.height());
    s.sightCount = 0;
    s.visibilityPixels = new Uint32Array(s.exploredVisibility.coverage().length);
    s.visibilityPicture = new PictureNode(
      new Uint8Array(s.visibilityPixels.buffer),
      s.exploredVisibility.columns(),
      s.exploredVisibility.rows(),
    );
    s.fogBorder = new ShapeNode().fill(0, 0, 0);
    s.fog.add(s.fogBorder).add(s.visibilityPicture);
    fitToView(s, true);
    changed = new VisibilityRegion(0, 0, s.exploredVisibility.columns(), s.exploredVisibility.rows());
  }
  const exploredVersion = s.exploredVisibility.revision(),
    history = map.sights();
  if (history.length < s.sightCount) {
    if (s.exploredVisibility.clear())
      changed = new VisibilityRegion(0, 0, s.exploredVisibility.columns(), s.exploredVisibility.rows());
    s.sightCount = 0;
  }
  for (; s.sightCount < history.length; s.sightCount++) {
    const sight = { ...history[s.sightCount] },
      giant = map.giant();
    if (
      giant &&
      giant
        .sights()
        .some(
          (old) =>
            old.center.x === sight.center.x && old.center.y === sight.center.y && old.radius === sight.radius,
        )
    )
      continue;
    sight.radius = f32(sight.radius + 1);
    s.exploredVisibility.stamp(sight, changed);
  }
  const night = town.climate().night,
    blend = (day: number, dark: number) => f32(day + f32(f32(dark - day) * night));
  s.vision = [];
  for (const p of town.people())
    if (belongsToFaction(p) && p.visibility() > 0)
      s.vision.push({ center: { ...p.position }, radius: blend(f32(8.5), 5) });
  for (const b of town.buildings()) {
    if (!isPlayerBuilding(b) || !b.built()) continue;
    if (b.kind === Structure.Torch) {
      s.vision.push({ center: { ...b.center }, radius: blend(4, f32(6.5)) });
      continue;
    }
    const half = f32(structureSpec(b.kind).size / 2);
    let glow = 1;
    if (isSeat(b.kind)) glow = 4;
    else if (
      isLodging(b.kind) ||
      [Structure.Tavern, Structure.Guild, Structure.GuildHall, Structure.Chapel].includes(b.kind)
    )
      glow = f32(2.5);
    else if (isHome(b.kind)) glow = f32(1.5);
    s.vision.push({ center: { ...b.center }, radius: f32(half + blend(5, f32(3 + f32(glow * f32(1.4))))) });
  }
  const volcano = map.volcano();
  if (
    volcano &&
    s.vision.some(
      (sight) => distance(sight.center, volcano.center()) <= f32(sight.radius + volcano.sights()[0].radius),
    )
  )
    s.vision.push(...volcano.sights());
  const currentChanged = s.currentVisibility.assign(s.vision, changed);
  if (first || currentChanged)
    for (const source of s.vision) {
      const sight = { ...source, radius: f32(source.radius + 1) };
      s.exploredVisibility.stamp(sight, changed);
    }
  if (first || currentChanged || exploredVersion !== s.exploredVisibility.revision()) {
    const explored = s.exploredVisibility.coverage(),
      current = s.currentVisibility.coverage();
    let pixelsChanged = first;
    for (let y = changed.top; y < changed.bottom; y++) {
      const row = y * s.exploredVisibility.columns();
      for (let i = row + changed.left; i < row + changed.right; i++) {
        const seen = current[i],
          known = explored[i],
          memory = Math.trunc((190 * (255 - seen) + 127) / 255),
          alpha = 255 - Math.trunc(((255 - memory) * known + 127) / 255),
          tint = Math.trunc((memory * known + 127) / 255),
          pixel =
            ((alpha << 24) |
              (Math.trunc((8 * tint + 127) / 255) << 16) |
              (Math.trunc((3 * tint + 127) / 255) << 8) |
              Math.trunc((2 * tint + 127) / 255)) >>>
            0;
        pixelsChanged ||= s.visibilityPixels[i] !== pixel;
        s.visibilityPixels[i] = pixel;
      }
    }
    if (pixelsChanged) s.visibilityPicture!.load(new Uint8Array(s.visibilityPixels.buffer));
    if (first) {
      const b = s.exploredVisibility.bounds();
      s.visibilityPicture!.transform([
        f32(b.w / s.exploredVisibility.columns()),
        0,
        b.x,
        0,
        f32(b.h / s.exploredVisibility.rows()),
        b.y,
        0,
        0,
        1,
      ]);
    }
  }
  s.fog.opacity(255);
}
