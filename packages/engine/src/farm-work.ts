import type { Town } from './town';
import type { Person } from './person';
import { Season, type Building } from './town-models';
import { taskEfficiency, type WorkKind } from './equipment';
import { TownState } from './town-state';
import { add, centroid, closestOnSegment, contains, distance, normalized, point, scale, sub, type Point } from './geometry';
// Animation is derived from the actual outdoor work state; it never moves a unit.
/** 0 hoes, 1 waters. A plot that is still being broken in is only ever hoed. */
export const farmWorkPhase = (
  person: Person,
  time: number,
  fields: readonly { id?: number; tilled?: number }[] = [],
): 0 | 1 =>
  (fields.find((field) => field.id === person.workField)?.tilled ?? 1) < 1
    ? 0
    : (Math.floor((time + person.id * 1.7) / 6) % 2 as 0 | 1);
export const tillSecondsPerAcre = 2.5;
/** What a farmhand's tools count for at the field now: new soil takes a shovel too, a standing crop a sickle. */
export function fieldWork(town: Town, person: Person): readonly WorkKind[] {
  if (farmWorkPhase(person, town.time, town.farmland) === 1) return ['watering'];
  const field = town.farmland.find((item) => item.id === person.workField);
  if (field && field.tilled < 1) return ['farming', 'digging'];
  const season = town.calendar().season;
  return season === Season.Summer || season === Season.Autumn ? ['farming', 'reaping'] : ['farming'];
}
export const fieldEfficiency = (town: Town, person: Person): number =>
  taskEfficiency(person, fieldWork(town, person));
/** Rows run along the longest edge; tilling advances across them from one side. */
export function fieldRows(outline: readonly Point[]): { along: Point; across: Point; center: Point; reach: number } {
  let along = point(1, 0),
    longest = 0;
  for (let i = 0; i < outline.length; i++) {
    const edge = sub(outline[(i + 1) % outline.length], outline[i]),
      size = Math.hypot(edge.x, edge.y);
    if (size > longest) {
      longest = size;
      along = normalized(edge);
    }
  }
  const center = centroid(outline as Point[]);
  let reach = 0;
  for (const p of outline) reach = Math.max(reach, distance(p, center));
  return { along, across: point(-along.y, along.x), center, reach };
}
/** Hoeing an untilled plot turns its soil; returns true when a visible strip was finished. */
export function tillField(town: Town, person: Person, seconds: number): boolean {
  const field = town.farmland.find((item) => item.id === person.workField);
  if (!field || field.tilled >= 1) return false;
  const before = field.tilled;
  field.tilled = Math.min(1, field.tilled + seconds / Math.max(1, field.acres() * tillSecondsPerAcre));
  if (field.tilled >= 1) town.notify('A field is tilled and ready for sowing');
  return Math.trunc(field.tilled * 16) !== Math.trunc(before * 16) || field.tilled >= 1;
}
export function prepareFarmWork(town: Town, person: Person, farm: Building): boolean {
  let field = town.farmland.find(item => item.id === person.workField && distance(centroid(item.outline), farm.center) <= TownState.farmReach);
  // A worker breaking in a plot follows the furrow being cut rather than standing still.
  if (field && field.tilled < 1) {
    const rows = fieldRows(field.outline),
      front = add(rows.center, scale(rows.across, rows.reach * (2 * field.tilled - 1)));
    if (distance(person.goal, closestOnSegment(person.goal, sub(front, scale(rows.along, rows.reach)), add(front, scale(rows.along, rows.reach)))) > 0.35) {
      for (let lane = 0; lane < 9; ++lane) {
        const at = add(front, scale(rows.along, ((((person.id + lane) % 5) - 2) * rows.reach) / 4));
        if (!contains(field.outline, at) || !town.grid.walkable(at)) continue;
        person.goal = { ...at };
        break;
      }
    }
  }
  if (field && contains(field.outline, person.goal) && town.grid.walkable(person.goal)) {
    if (distance(person.position, person.goal) <= .04 || person.moving()) return true;
    return town.walkTo(person, person.goal);
  }
  person.workField = -1;
  const fields = town.farmland.filter(item => distance(centroid(item.outline),farm.center) <= TownState.farmReach);
  // Untilled plots come first: nothing grows on them until they are broken in.
  fields.sort((a,b) => Number(a.tilled >= 1) - Number(b.tilled >= 1) || distance(centroid(a.outline),farm.center)-distance(centroid(b.outline),farm.center) || a.id-b.id);
  for (field of fields) {
    const center=centroid(field.outline), points=[center];
    // Distinct stable rows keep workers outdoors without selecting a new target
    // every scheduler tick. Concave fields still require an interior walkable point.
    for(let row=0;row<12;++row) points.unshift(point(center.x+((person.id+row)%4-.5)*.45,center.y+(Math.floor((person.id+row)/4)%3-1)*.45));
    for(const at of points) {
      if(!contains(field.outline,at)||!town.grid.walkable(at)||!town.walkTo(person,at)) continue;
      person.workField=field.id;person.goal={...at};return true;
    }
  }
  return false;
}
