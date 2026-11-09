import type { Town } from './town';
import type { Person } from './person';
import type { Building } from './town-models';
import { TownState } from './town-state';
import { centroid, contains, distance, point } from './geometry';
// Animation is derived from the actual outdoor work state; it never moves a unit.
export const farmWorkPhase = (person: Person, time: number): 0 | 1 =>
  Math.floor((time + person.id * 1.7) / 6) % 2 as 0 | 1;
export function prepareFarmWork(town: Town, person: Person, farm: Building): boolean {
  let field = town.farmland.find(item => item.id === person.workField && distance(centroid(item.outline), farm.center) <= TownState.farmReach);
  if (field && contains(field.outline, person.goal) && town.grid.walkable(person.goal)) {
    if (distance(person.position, person.goal) <= .04 || person.moving()) return true;
    return town.walkTo(person, person.goal);
  }
  person.workField = -1;
  const fields = town.farmland.filter(item => distance(centroid(item.outline),farm.center) <= TownState.farmReach);
  fields.sort((a,b) => distance(centroid(a.outline),farm.center)-distance(centroid(b.outline),farm.center) || a.id-b.id);
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
