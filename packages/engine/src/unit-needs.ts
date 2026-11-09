import { TownState } from './town-state';
import { Person, Role, Activity, AnimalKind } from './person';
import { Building } from './town-models';
import { Resources, Structure, Product, isHome, isLodging } from './building-catalog';
import { Point, distance, point, add, rotated } from './geometry';
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
  drink(p: Person): boolean;
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
      isHome(kind) || kind === Structure.Storehouse || kind === Structure.Granary || kind === Structure.Tavern || (p.role === Role.Guest && isLodging(kind)),
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
  if (p.role === Role.Resident || !p.autoMode || p.ordered) return false;
  if (p.hydration < f(.25) && this.drink(p)) return true;
  if (p.food < f(0.25) && this.eat(p)) return true;
  if (p.rest < f(0.2) && p.task !== Activity.Building && p.task !== Activity.Roadwork) {
    const bed = this.building(p.bed),
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

// Hunting is an automatic food transaction; the kill yields a meal and carried
// surplus, not food teleported to the treasury from across the map.
export function huntFood(this: import('./town').Town, p: Person): boolean {
  if (p.hunting && this.creature(p.foe)?.health! > 0) return true;
  if (p.carrying > 0) {
    if (p.carriedProduct === Product.Food) {
      --p.carrying; p.food = 1; ++this.economy(this.settlementOf(p)).today.eaten;
      return p.carrying ? this.haulCargo(p) : true;
    }
    // A single cargo slot must never silently turn existing wood/stone into meat.
    return this.haulCargo(p);
  }
  const prey = this.animals.filter(a => a.health > 0 && a.animal !== null &&
    [AnimalKind.Chicken, AnimalKind.Pig, AnimalKind.Cow].includes(a.animal) && this.world.revealed(a.position));
  prey.sort((a,b) => distance(p.position,a.position)-distance(p.position,b.position) || a.id-b.id);
  for (const animal of prey) {
    if (!this.walkTo(p, animal.position)) continue;
    p.hunting = true; p.foe = animal.id; p.activity = Activity.Fighting;
    return true;
  }
  return false;
}

export function drink(this: import('./town').Town, p: Person): boolean {
  const village = this.settlementOf(p),
    facilities = this.placed.filter(b => b.built() && b.kind === Structure.Well && this.settlementOf(b) === village);
  facilities.sort((a,b) => distance(p.position,a.door())-distance(p.position,b.door()) || a.id-b.id);
  for (const well of facilities) {
    if (!this.walkTo(p, well.door())) continue;
    p.activity = Activity.Drinking; p.target = well.id; p.tree = -1;
    if (!p.moving()) this.arrive(p);
    return true;
  }
  if (p.role !== Role.Resident) return false;
  let pending = this.placed.find(b => b.kind === Structure.Well && this.settlementOf(b) === village);
  if (!pending) {
    const anchor = this.camp(village)?.center ?? p.position;
    // Search usable land around the settlement, respecting normal placement and
    // construction costs. No fixed world coordinate or free completed well.
    outer: for (let radius = 2; radius <= 8; ++radius) for (let i=0;i<16;++i) {
      const placement = this.fit(Structure.Well, add(anchor, rotated(point(radius,0),i*Math.PI/8)),0);
      if (this.place(Structure.Well,placement.center,placement.angle)) {
        pending = this.placed.at(-1); break outer;
      }
    }
  }
  if (pending && this.orderBuild([p.id], pending.id)) { p.ordered = false; return true; }
  return false;
}
