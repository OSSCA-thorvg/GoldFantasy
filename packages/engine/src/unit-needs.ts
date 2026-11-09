import { TownState } from './town-state';
import { Person, Role, Activity } from './person';
import { Building } from './town-models';
import { Resources, Structure, isHome, isLodging } from './building-catalog';
import { Point, distance, point, add } from './geometry';
import { f32 as f } from './numeric';
export interface NeedsTown extends TownState {
  stock(id?: number): Resources;
  settlementOf(p: Person | Building): number;
  settlementAt(p: Point): number;
  walkTo(p: Person, at: Point): boolean;
  arrive(p: Person): void;
  camp(id?: number): Building | null;
  nearest(at: Point, match: (b: Building) => boolean): Building | null;
  eat(p: Person): boolean;
}
export function eat(this: NeedsTown, p: Person): boolean {
  const visit = (place: Building): boolean => {
      if (this.stock(this.settlementOf(place)).food <= 0) return false;
      if (!this.walkTo(p, place.door())) return false;
      p.activity = Activity.Eating;
      p.target = place.id;
      p.tree = -1;
      if (!p.moving()) this.arrive(p);
      return true;
    },
    eatery = (kind: Structure): boolean =>
      isHome(kind) || kind === Structure.Tavern || (p.role === Role.Guest && isLodging(kind)),
    own = this.building(p.home);
  if (own && own.built() && eatery(own.kind) && visit(own)) return true;
  const eateries = this.placed.filter(
    (place) => place.built() && eatery(place.kind) && !isHome(place.kind) && place !== own,
  );
  eateries.sort((a, b) => distance(p.position, a.door()) - distance(p.position, b.door()));
  for (const place of eateries) if (visit(place)) return true;
  const shelter = this.camp(this.settlementAt(p.position));
  return !!shelter && shelter.built() && visit(shelter);
}
export function takeBreak(this: NeedsTown, p: Person): boolean {
  if (!p.autoMode || p.ordered) return false;
  if (p.food < f(0.25) && this.eat(p)) return true;
  if (p.rest < f(0.2) && p.task !== Activity.Building && p.task !== Activity.Roadwork) {
    const bed = this.building(p.role === Role.Resident ? p.home : p.bed),
      sleep = (place: Building | null): boolean => {
        if (
          !place ||
          !place.built() ||
          (p.role !== Role.Guest && isLodging(place.kind)) ||
          !this.walkTo(p, place.door())
        )
          return false;
        p.activity = Activity.Sleeping;
        p.target = place.id;
        p.tree = -1;
        if (!p.moving()) this.arrive(p);
        return true;
      };
    if (sleep(bed) || (p.role === Role.Guest && sleep(this.camp(this.settlementOf(p))))) return true;
    p.activity = Activity.Sleeping;
    p.path = [];
    p.tree = -1;
    p.target = -1;
    p.inside = false;
    p.sleptOutside = true;
    return true;
  }
  if (p.stress < f(0.85)) return false;
  const tavern = this.nearest(p.position, (b) => b.built() && b.kind === Structure.Tavern);
  if (tavern && this.walkTo(p, tavern.door())) {
    p.activity = Activity.Relaxing;
    p.target = tavern.id;
    if (!p.moving()) this.arrive(p);
  } else {
    p.activity = Activity.Brooding;
    p.path = [];
    p.target = -1;
    this.walkTo(
      p,
      this.grid.nearestWalkable(add(p.position, point(f(f(this.roll() * 4) - 2), f(f(this.roll() * 4) - 2)))),
    );
    p.until = this.time + 8;
  }
  p.tree = -1;
  return true;
}
