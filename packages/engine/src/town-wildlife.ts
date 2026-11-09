import { TownState } from './town-state';
import { Person, Monster, AnimalKind, Activity } from './person';
import { Resources } from './building-catalog';
import { Region } from './world-types';
import { Point, point, add, sub, scale, normalized, rotated, distance, lerp } from './geometry';
import { f32 as f, hash01, clamp, lround } from './numeric';
import { animalKindCount, animalSpec } from './wildlife';
export interface WildlifeTown extends TownState {
  settlementOf(p: Person): number;
  settlementAt(at: Point): number;
  stock(id?: number): Resources;
  store(gain: Resources, village: number): void;
  hurtGuest(p: Person, killed: boolean): void;
  populateWildlife(): void;
}
export function creature(this: TownState, id: number): Monster | null {
  for (const group of [this.beasts, this.animals])
    for (const creature of group) if (creature.id === id) return creature;
  return null;
}
export function creatureTarget(this: TownState, id: number): Monster | null {
  return creature.call(this, id);
}
export function populateWildlife(this: WildlifeTown): void {
  if (this.wildlifeDay === this.days) return;
  this.wildlifeDay = this.days;
  const perKind = clamp(Math.trunc((this.world.width() * this.world.height()) / 1800), 4, 16),
    clearing = this.world.camp(),
    approach = this.grid.nearestWalkable(clearing);
  const habitat = (p: Point): boolean =>
    this.world.inside(p) &&
    this.world.regionAt(p) === Region.Middle &&
    this.grid.walkable(p) &&
    this.world.cell(p)!.dungeon < 0 &&
    distance(p, clearing) >= 4;
  for (let kind = 0; kind < animalKindCount; ++kind) {
    let count = this.animals.filter((m) => m.animal === kind && m.health > 0).length;
    let nearby = this.animals.filter(
      (m) => m.animal === kind && m.health > 0 && distance(m.home, clearing) <= 11,
    ).length;
    const nearbyTarget = kind === AnimalKind.Wolf ? 0 : 2;
    let attempts = 0;
    while (count < perKind && attempts++ < 2000) {
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
      animal.health = animalSpec(kind).health;
      animal.ready = this.time + f(hash01(this.world.seed(), animal.id, this.days, 192) * 5);
      this.animals.push(animal);
      ++count;
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
      const hunter = this.person(animal.provokedBy),
        village = hunter ? this.settlementOf(hunter) : this.settlementAt(animal.position),
        before = this.stock(village).food;
      this.store(new Resources(0, 0, 0, spec.food), village);
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
          (animal.animal === AnimalKind.Wolf ? f(0.07) : f(0.045)) / attacker.vitalityMultiplier(),
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
        });
        animal.ready = this.time + 1.4;
        this.hurtGuest(attacker, attacker.health <= 0);
        if (attacker.health <= 0) {
          attacker.health = -1;
          attacker.activity = Activity.Leaving;
          this.notify(attacker.name + ' fell while hunting');
        }
      } else if (gap > f(0.8)) {
        const next = add(
          animal.position,
          scale(normalized(sub(attacker.position, animal.position)), Math.min(gap, f(spec.speed * f(dt)))),
        );
        if (habitat(next)) animal.position = next;
      }
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
