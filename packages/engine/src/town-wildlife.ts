import { TownState } from './town-state';
import type { CampEconomy } from './camp-economy';
import { Person, Monster, AnimalKind, Activity } from './person';
import { Resources, Product } from './building-catalog';
import { Region } from './world-types';
import { Point, point, add, sub, scale, normalized, rotated, distance, lerp } from './geometry';
import { f32 as f, hash01, clamp, lround } from './numeric';
import { animalKindCount, animalSpec } from './wildlife';
import { armorProtection, huntItem } from './equipment';
import { inArea } from './realm-layout';
import { Season, type Calendar } from './town-models';
import { Boon, boon, boonRules } from './gate-boons';
import { StrikeKind } from './skill-catalog';
export interface WildlifeTown extends TownState {
  settlementOf(p: Person): number;
  economy(village: number): CampEconomy;
  settlementAt(at: Point): number;
  stock(id?: number): Resources;
  store(gain: Resources, village: number): void;
  hurtGuest(p: Person, killed: boolean): void;
  strikeDown(p: Person, cause: string, notice?: string): void;
  tallyKill(foe: Monster): void;
  populateWildlife(): void;
  calendar(): Calendar;
}
export function creature(this: TownState, id: number): Monster | null {
  for (const group of [this.beasts, this.animals])
    for (const creature of group) if (creature.id === id) return creature;
  return null;
}
export function creatureTarget(this: TownState, id: number): Monster | null {
  return creature.call(this, id);
}
/** Herd and yard animals sleep at night; wolves and cats prowl then and sleep by day. A blow wakes any of them. */
export function animalAsleep(this: TownState, animal: Monster): boolean {
  if (animal.animal === null || animal.health <= 0 || animal.angry) return false;
  const night = this.climate().night,
    nocturnal = animal.animal === AnimalKind.Wolf || animal.animal === AnimalKind.Cat;
  return nocturnal ? night < f(0.15) && hash01(this.world.seed(), animal.id, this.days, 196) < f(0.7) : night > f(0.6);
}
export function populateWildlife(this: WildlifeTown): void {
  if (this.wildlifeDay === this.days) return;
  // Only the first stocking fills the map; afterwards each species returns one a day.
  const births = this.wildlifeDay < 0 ? Infinity : 1,
    season = this.calendar().season,
    scarcity = boon(this, Boon.Hearth) ? 1 : season === Season.Winter ? 0.4 : season === Season.Autumn ? 0.75 : 1;
  this.wildlifeDay = this.days;
  // Sparse populations leave room for settlement activity: 30 animals on the
  // default map, with smaller maps retaining a few of each native species.
  const perKind = Math.max(
      1,
      Math.round(clamp(Math.trunc((this.world.width() * this.world.height()) / 6000), 2, 5) * scarcity),
    ),
    clearing = this.world.camp(),
    approach = this.grid.nearestWalkable(clearing);
  const habitat = (p: Point): boolean =>
    this.world.inside(p) &&
    !inArea(this.realmArea, p) &&
    this.world.regionAt(p) === Region.Middle &&
    this.grid.walkable(p) &&
    this.world.cell(p)!.dungeon < 0 &&
    distance(p, clearing) >= 4;
  for (let kind = 0; kind < animalKindCount; ++kind) {
    let count = this.animals.filter((m) => m.animal === kind && m.health > 0).length;
    let nearby = this.animals.filter(
      (m) => m.animal === kind && m.health > 0 && distance(m.home, clearing) <= 11,
    ).length;
    const nearbyTarget = kind === AnimalKind.Wolf ? 0 : 1;
    let attempts = 0,
      born = 0;
    while (count < perKind && born < births && attempts++ < 2000) {
      const salt = kind * 2000 + attempts,
        a = hash01(this.world.seed(), this.days, salt, 190),
        b = hash01(this.world.seed(), this.days, salt, 191);
      const at =
        nearby < nearbyTarget && attempts <= 300
          ? add(clearing, rotated(point(f(f(4.5) + f(a * 6)), 0), f(b * f(6.2832))))
          : point(f(2 + f(a * (this.world.width() - 4))), f(2 + f(b * (this.world.height() - 4))));
      if (!habitat(at)) continue;
      const fromClearing = distance(at, clearing);
      if (kind === AnimalKind.Wolf && fromClearing < 10) continue;
      if (this.animals.some((m) => distance(m.position, at) < 2)) continue;
      if (this.placed.some((b) => b.footprint().contains(at, 1))) continue;
      if (fromClearing <= 11 && !this.grid.path(approach, at).length) continue;
      const animal = new Monster(this.nextMonster++, -1, at);
      animal.animal = kind;
      animal.home = { ...at };
      animal.health = animal.vigor = animalSpec(kind).health;
      animal.ready = this.time + f(hash01(this.world.seed(), animal.id, this.days, 192) * 5);
      this.animals.push(animal);
      ++count;
      ++born;
      if (fromClearing <= 11) ++nearby;
    }
  }
}
export function stirWildlife(this: WildlifeTown, dt: number): void {
  this.animalCalls = this.animalCalls.filter((call) => this.time - call.at <= 2);
  this.populateWildlife();
  const habitat = (at: Point): boolean =>
    this.world.inside(at) && this.world.regionAt(at) === Region.Middle && this.grid.walkable(at);
  for (const animal of this.animals) {
    const spec = animalSpec(animal.animal!);
    if (animal.health <= 0) {
      this.tallyKill(animal);
      const hunter = this.person(animal.provokedBy),
        // A knife on whoever made the kill dresses more of it.
        dressed = 1 + (hunter ? (huntItem(hunter)?.huntBonus ?? 0) : 0),
        food = Math.round((boon(this, Boon.Plenty) ? Math.round(spec.food * boonRules.plentyFood) : spec.food) * dressed),
        village = hunter ? this.settlementOf(hunter) : this.settlementAt(animal.position),
        before = this.stock(village).food;
      const remains = new Resources();
      remains.bones = Math.ceil(Math.max(1, Math.ceil(spec.food / 3)) * dressed);
      this.store(remains, village);
      if (hunter?.hunting && hunter.foe === animal.id) {
        hunter.hunting = false; hunter.foe = -1; hunter.path = [];
        hunter.carriedProduct = Product.Food; hunter.carrying += food;
        if (hunter.food < f(.25)) { --hunter.carrying; hunter.food = 1; ++this.economy(village).today.eaten; }
        hunter.activity = Activity.Idle; hunter.until = this.time;
        this.notify(spec.name + ' hunted (carrying ' + hunter.carrying + ' food)');
        continue;
      }
      this.store(new Resources(0, 0, 0, food), village);
      const gained = this.stock(village).food - before;
      this.notify(spec.name + ' hunted (+' + gained + ' food)');
      continue;
    }
    let attacker = animal.angry ? this.person(animal.provokedBy) : null;
    if (
      attacker &&
      (attacker.health <= 0 ||
        attacker.inside ||
        distance(attacker.position, animal.home) > 8 ||
        this.world.regionAt(attacker.position) !== Region.Middle)
    )
      attacker = null;
    if (!attacker) {
      animal.angry = false;
      animal.provokedBy = -1;
    }
    if (attacker && spec.defends) {
      const gap = distance(animal.position, attacker.position);
      animal.path = [];
      if (gap <= f(0.8) && this.time >= animal.ready) {
        const bite = f(
          (animal.animal === AnimalKind.Wolf ? f(0.045) : f(0.028)) * (1 - armorProtection(attacker)) / attacker.vitalityMultiplier(),
        );
        attacker.health = f(attacker.health - bite);
        attacker.stress = Math.min(1, f(attacker.stress + f(0.02)));
        this.blows.push({
          serial: this.nextBlow++,
          from: { ...animal.position },
          to: { ...attacker.position },
          damage: lround(f(bite * 100)),
          onPerson: true,
          ranged: false,
          at: this.time,
          person: attacker.id,
          strike: StrikeKind.Single,
          primary: true,
        });
        animal.swingAt = this.time;
        animal.ready = this.time + 1.4;
        this.hurtGuest(attacker, attacker.health <= 0);
        if (attacker.health <= 0)
          this.strikeDown(attacker, `Killed by a ${spec.name.toLowerCase()}`, attacker.name + ' fell while hunting');
      } else if (gap > f(0.8)) {
        const next = add(
          animal.position,
          scale(normalized(sub(attacker.position, animal.position)), Math.min(gap, f(spec.speed * f(dt)))),
        );
        if (habitat(next)) animal.position = next;
      }
      continue;
    }
    if (!attacker && animalAsleep.call(this, animal)) {
      animal.path = [];
      continue;
    }
    if ((!animal.path.length || attacker) && this.time >= animal.ready) {
      animal.ready = this.time + (attacker ? 1.5 : 3);
      for (let attempt = 0; attempt < 10; ++attempt) {
        const beat = Math.trunc(this.time / 3) * 10 + attempt,
          offset = attacker
            ? scale(normalized(sub(animal.position, attacker.position)), 3)
            : rotated(
                point(f(1 + f(hash01(this.world.seed(), animal.id, beat, 194) * 3)), 0),
                f(hash01(this.world.seed(), animal.id, beat, 195) * f(6.2832)),
              ),
          target = add(
            attacker ? animal.position : animal.home,
            rotated(offset, attacker ? f((attempt - 4) * f(0.25)) : 0),
          );
        if (!habitat(target) || distance(target, animal.home) > 7) continue;
        const path = this.grid.path(animal.position, target);
        let middle = !!path.length,
          from = animal.position;
        for (const to of path) {
          const samples = Math.max(1, Math.ceil(f(distance(from, to) * 4)));
          for (let i = 1; i <= samples; ++i) {
            const valid = habitat(lerp(from, to, f(i / samples)));
            middle = middle && valid;
          }
          from = to;
        }
        if (middle) {
          animal.path = path;
          break;
        }
      }
    }
    let step = f(f(spec.speed * f(dt)) * (attacker ? f(1.4) : f(0.45)));
    while (step > 0 && animal.path.length) {
      const target = animal.path[0],
        gap = distance(animal.position, target),
        next =
          gap <= step
            ? { ...target }
            : add(animal.position, scale(sub(target, animal.position), f(step / gap)));
      if (!habitat(next)) {
        animal.path = [];
        break;
      }
      animal.position = next;
      if (gap <= step) {
        animal.path.shift();
        step = f(step - gap);
      } else step = 0;
    }
  }
  this.animals = this.animals.filter((m) => m.health > 0);
}
