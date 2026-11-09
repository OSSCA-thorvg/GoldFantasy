import { point, project, contains, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import type { Building } from '../../engine/src/town-models';
import type { Town } from '../../engine/src/town';
import { structureSpec } from '../../engine/src/building-catalog';
import { SceneNode, ShapeNode } from './paint';
import { poly, stroke, oval } from './sprite-primitives';
import { buildingAppearanceRevision, structureModel } from './building-assets';
import { orientModel, splitAngle } from './building-model';
import { Motion, buildingFaces, FaceStyle } from './building-faces';
import { depthBatches } from './building-depth';
import type { WorldRendererState } from './world-renderer-state';

interface DamageVisual {
  paint: SceneNode;
  key: string;
  smoke: { paint: ShapeNode; at: Point; phase: number }[];
}
const cache = new WeakMap<WorldRendererState, Map<number, DamageVisual>>();
const entries = (s: WorldRendererState) => {
  let values = cache.get(s);
  if (!values) {
    values = new Map();
    cache.set(s, values);
  }
  return values;
};
export const damageLevel = (health: number): number =>
  health >= 0.85 ? 0 : health >= 0.6 ? 1 : health >= 0.35 ? 2 : health >= 0.15 ? 3 : 4;
export function damagePaint(s: WorldRendererState, building: Building): SceneNode {
  const values = entries(s);
  let entry = values.get(building.id);
  if (!entry) {
    entry = { paint: new SceneNode(), key: '', smoke: [] };
    values.set(building.id, entry);
  }
  return entry.paint;
}
const area = (points: readonly Point[]) =>
  Math.abs(
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );

function rebuild(entry: DamageVisual, building: Building, level: number): void {
  entry.paint.remove();
  entry.smoke = [];
  if (!level) return;
  const model = structureModel(building.kind, building.variant),
    size = structureSpec(building.kind).size;
  const turn = splitAngle(building.angle);
  orientModel(model, turn.quarterTurns, size);
  const motion = new Motion();
  motion.turn = turn.remainder;
  motion.pivot = point(size / 2, size / 2);
  const faces = buildingFaces(model, motion),
    batches = depthBatches(faces, 1000);
  const corner = building.corner(),
    anchor = project(corner.x, corner.y);
  const polygons = batches
    .filter((batch) => !batch.line && faces[batch.source].style !== FaceStyle.Line)
    .flatMap((batch) => batch.polygons)
    .map((points) => points.map((p) => point(p.x + anchor.x, p.y + anchor.y)));
  const minimumArea = Math.min(70, Math.max(4, ...polygons.map(area)) * 0.45);
  let scars = 0;
  for (let i = polygons.length - 1; i >= 0 && scars < level + 2; i--) {
    const polygon = polygons[i];
    if (area(polygon) < minimumArea) continue;
    const center = point(
      polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
      polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
    );
    // Only mark an exposed surface; rear walls behind another roof must stay hidden.
    if (polygons.slice(i + 1).some((other) => contains(other, center))) continue;
    const left = Math.min(...polygon.map((p) => p.x)),
      right = Math.max(...polygon.map((p) => p.x));
    const top = Math.min(...polygon.map((p) => p.y)),
      bottom = Math.max(...polygon.map((p) => p.y));
    const width = Math.min(12, (right - left) * 0.3),
      height = Math.min(16, (bottom - top) * 0.55);
    const mark = new SceneNode(),
      cut = poly(polygon, [255, 255, 255]);
    mark.clip(cut);
    const crack = new ShapeNode()
      .moveTo(center.x - 1, center.y - height * 0.65)
      .lineTo(center.x + width * 0.16, center.y - height * 0.3)
      .lineTo(center.x - width * 0.17, center.y)
      .lineTo(center.x + width * 0.2, center.y + height * 0.45)
      .moveTo(center.x - width * 0.17, center.y)
      .lineTo(center.x - width * 0.7, center.y - height * 0.1)
      .lineTo(center.x - width * 0.85, center.y - height * 0.35);
    crack
      .strokeWidth(0.65 + level * 0.2)
      .strokeCap('round')
      .strokeFill(35, 29, 27, 230);
    mark.add(crack);
    if (level >= 2) {
      const r = Math.min(width * 0.4, 1.4 + level * 0.65);
      mark.add(
        poly(
          [
            [center.x - r, center.y],
            [center.x - r * 0.4, center.y - r],
            [center.x + r * 0.5, center.y - r * 0.8],
            [center.x + r, center.y + r * 0.3],
            [center.x + r * 0.3, center.y + r],
          ],
          [31, 28, 27],
        ),
      );
      mark.add(
        stroke(
          [center.x - r, center.y + 0.3],
          [center.x + r * 0.3, center.y + r + 0.3],
          0.65,
          [184, 153, 107],
        ),
      );
    }
    entry.paint.add(mark);
    scars++;
  }
  if (level >= 2) {
    const corners = building
        .footprint()
        .corners()
        .map((p) => project(p.x, p.y)),
      front = corners.reduce((a, b) => (a.y > b.y ? a : b));
    for (let i = 0; i < level * 3; i++) {
      const x = front.x + (hash01(building.id, i, 7, 91) - 0.5) * size * 48,
        y = front.y + hash01(building.id, i, 9, 93) * 6,
        r = 1.3 + hash01(building.id, i, 4, 95) * 2.1;
      entry.paint.add(
        poly(
          [
            [x - r, y],
            [x - r * 0.4, y - r],
            [x + r * 0.7, y - r * 0.6],
            [x + r, y + 0.5],
            [x, y + r * 0.4],
          ],
          i % 2 ? [103, 95, 82] : [143, 124, 96],
        ),
      );
    }
  }
  if (level >= 3 && polygons.length) {
    const roofY = Math.min(...polygons.flatMap((p) => p.map((v) => v.y))),
      center = project(building.center.x, building.center.y);
    for (let i = 0; i < 3; i++) {
      const puff = oval([0, 0], 2.5 + i, 1.8 + i * 0.65, [68, 63, 57, 55]);
      entry.paint.add(puff);
      entry.smoke.push({ paint: puff, at: point(center.x + (i - 1) * 5, roofY + 9), phase: i / 3 });
    }
  }
}
export function updateBuildingDamage(s: WorldRendererState, town: Town): void {
  const values = entries(s);
  for (const [id, entry] of values) {
    const building = town.building(id);
    if (!building) {
      values.delete(id);
      continue;
    }
    const level = building.built() ? damageLevel(building.health) : 0;
    const key = [
      building.kind,
      building.variant,
      building.version,
      building.center.x,
      building.center.y,
      building.angle,
      buildingAppearanceRevision(building.kind),
      level,
    ].join(':');
    if (key !== entry.key) {
      entry.key = key;
      rebuild(entry, building, level);
    }
    for (const puff of entry.smoke) {
      const phase = (town.clock() * 0.22 + puff.phase) % 1,
        size = 0.7 + phase * 1.5;
      puff.paint.transform([size, 0, puff.at.x + phase * 7, 0, size, puff.at.y - phase * 20, 0, 0, 1]);
      puff.paint.opacity(Math.round(150 * Math.sin(phase * Math.PI)));
    }
  }
}
