import { nativeRandomRadial } from './native-random-order';
// Translated from Town::stir in src/game/town_monsters.cpp.
import { TownState } from './town-state';
import { Activity, Calling, Role, type Monster, type Person, type Expedition } from './person';
import { Resources, Structure } from './building-catalog';
import type { Building } from './town-models';
import type { CampEconomy } from './camp-economy';
import { point, add, sub, scale, rotated, normalized, distance, type Point } from './geometry';
import { f32 as f, lround } from './numeric';
import { breedOf, steps } from './town-monsters';
import { planRaiderApproach, separateMonsters } from './monster-navigation';
export interface EncounterTown extends TownState {
  wakeGiants(): void;
  stirWildlife(dt: number): void;
  camp(): Building | null;
  releaseMonster(at: Point): void;
  dayFraction(): number;
  summonRaid(): void;
  raiding(): boolean;
  giantsAwake(): boolean;
  roamGiant(beast: Monster, dt: number): void;
  staffed(kind: Structure): boolean;
  hurtGuest(person: Person, killed: boolean): void;
  wreck(beast: Monster, dt: number): void;
  settlementAt(at: Point): number;
  credit(gain: Resources, id: number): void;
  economy(id: number): CampEconomy;
  returnFrom(party: Expedition): void;
}
export function stir(this: EncounterTown, dt: number): void {
  this.blows = this.blows.filter((h) => !(this.time - h.at > 2));
  this.wakeGiants();
  this.stirWildlife(dt);
  const fire = this.camp(),
    roaming = this.beasts.filter((m) => !m.raider && !m.giant()).length;
  if (
    fire &&
    this.days >= 1 &&
    roaming < Math.min(8, 2 + Math.trunc(this.days / 7)) &&
    this.roll() < (dt / TownState.secondsPerDay) * 1.5
  ) {
    for (let attempt = 0; attempt < 12; ++attempt) {
      const at = add(fire.center, nativeRandomRadial(() => this.roll(), 16, 24, 6.2832));
      const x = Math.floor(at.x),
        y = Math.floor(at.y);
      if (!this.world.inside(x, y) || !this.grid.walkable(at)) continue;
      this.releaseMonster(at);
      break;
    }
  }
  if (
    fire &&
    fire.built() &&
    this.dayFraction() > f(0.5) &&
    this.climate().night > f(0.6) &&
    this.raidedDay !== this.days
  ) {
    this.raidedDay = this.days;
    this.summonRaid();
  }
  const raidOn = this.raiding();
  for (const beast of this.beasts) {
    if (beast.health <= 0) continue;
    if (beast.giant() && (beast.insideLair || (!this.giantsAwake() && !beast.angry))) {
      this.roamGiant(beast, dt);
      continue;
    }
    const breed = breedOf(this.world.dungeons()[beast.lair].kind);
    let prey: Person | undefined;
    const scent = beast.raider ? 9 : beast.angry ? 7 : 4;
    for (const p of this.folk)
      if (!beast.giant() || (p.id === beast.provokedBy && distance(p.position, beast.home) <= 7))
        if (
          !p.inside &&
          p.health > 0 &&
          distance(p.position, beast.position) < scent &&
          (!prey || distance(p.position, beast.position) < distance(prey.position, beast.position))
        )
          prey = p;
    if (prey) {
      const gap = distance(prey.position, beast.position);
      beast.path = [];
      beast.prey = -1;
      if (gap > f(0.7)) {
        let next = add(
          beast.position,
          scale(
            normalized(sub(prey.position, beast.position)),
            Math.min(gap, f(f(breed.speed * f(0.8)) * f(dt))),
          ),
        );
        const stone = (at: Point): boolean => this.world.giant()?.covers(at) ?? false;
        if (beast.raider && stone(next))
          for (const turn of [f(0.785), f(1.571), f(-0.785), f(-1.571)]) {
            const round = add(beast.position, rotated(sub(next, beast.position), turn));
            if (!stone(round)) {
              next = round;
              break;
            }
          }
        if (
          beast.giant() ? this.grid.walkable(next) : (beast.raider && !stone(next)) || steps(this.world, next)
        )
          beast.position = next;
      } else if (this.time >= beast.ready) {
        let bite = f(breed.bite * beast.strength * (prey.calling === Calling.Warrior ? f(0.6) : 1));
        if (prey.role === Role.Resident && this.staffed(Structure.Armorer)) bite = f(bite * f(0.6));
        bite = f(bite / f(1 + f(f(0.3) * prey.gear)));
        prey.health = f(prey.health - f(bite / prey.vitalityMultiplier()));
        this.blows.push({
          serial: this.nextBlow++,
          from: { ...beast.position },
          to: { ...prey.position },
          damage: Math.max(1, lround(f(bite * 100))),
          onPerson: true,
          ranged: false,
          at: this.time,
          person: prey.id,
        });
        prey.stress = Math.min(1, f(prey.stress + f(0.03)));
        beast.ready = this.time + breed.pause;
        this.hurtGuest(prey, prey.health <= 0);
        if (prey.health <= 0) {
          this.notify(
            prey.name + (beast.giant() ? ' was killed by a provoked giant' : ' was killed by monsters'),
          );
          prey.activity = Activity.Leaving;
          prey.health = -1;
        }
      }
      continue;
    }
    beast.angry = false;
    beast.provokedBy = -1;
    if (beast.giant()) {
      this.roamGiant(beast, dt);
      continue;
    }
    if (beast.raider) {
      planRaiderApproach(this, beast);
    } else if (!beast.path.length && this.roll() < dt * 0.3) {
      beast.path = [
        this.grid.nearestWalkable(
          add(beast.home, nativeRandomRadial(() => this.roll(), 1.5, 4, 6.2832)),
        ),
      ];
    }
    this.wreck(beast, dt);
    let step = f((beast.raider ? f(breed.speed * f(0.8)) : f(0.5)) * f(dt));
    while (step > 0 && beast.path.length) {
      const gap = distance(beast.position, beast.path[0]),
        next =
          gap <= step
            ? { ...beast.path[0] }
            : add(beast.position, scale(sub(beast.path[0], beast.position), f(step / gap)));
      if ((!beast.raider && !steps(this.world, next)) ||
        (beast.raider && this.grid.walkable(beast.position) && !this.grid.clear(beast.position, next, Infinity))) {
        beast.path = [];
        break;
      }
      beast.position = next;
      if (gap <= step) {
        beast.path.shift();
        step = f(step - gap);
      } else step = 0;
    }
  }
  separateMonsters(this, dt);
  for (const beast of this.beasts) {
    if (beast.health > 0) continue;
    const bounty = lround(
        f(breedOf(this.world.dungeons()[beast.lair].kind).health * (beast.raider ? f(1.5) : f(1.2))),
      ),
      village = this.settlementAt(beast.position);
    this.credit(new Resources(bounty), village);
    this.economy(village).today.bounty += bounty;
    this.raidBounty += beast.raider ? bounty : 0;
    if (beast.raider) ++this.raidKills;
    else this.notify((beast.giant() ? 'A giant is slain (+' : 'A monster is slain (+') + bounty + ' gold)');
  }
  this.beasts = this.beasts.filter((m) => m.health > 0);
  if (raidOn && !this.raiding()) {
    this.notify(`The raid is beaten off (${this.raidKills} slain, +${this.raidBounty} gold)`);
    this.raidKills = this.raidBounty = 0;
  }
  for (const party of this.parties) {
    party.members = party.members.filter((id) => !!this.person(id));
    if (!party.members.length) continue;
    const inside = party.members.every((id) => this.person(id)!.inside);
    if (inside && party.returnAt < 0) party.returnAt = this.time + TownState.secondsPerDay * 0.5;
    if (party.returnAt > 0 && this.time >= party.returnAt) this.returnFrom(party);
  }
  this.parties = this.parties.filter((e) => e.members.length > 0);
}
