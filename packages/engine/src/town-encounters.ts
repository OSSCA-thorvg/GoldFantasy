import { nativeRandomRadial } from './native-random-order';
// Translated from Town::stir in src/game/town_monsters.cpp.
import { TownState } from './town-state';
import { Activity, Calling, Role, type Monster, type Person } from './person';
import { Resources, Structure } from './building-catalog';
import type { Building } from './town-models';
import type { CampEconomy } from './camp-economy';
import { point, add, sub, scale, rotated, normalized, distance, type Point } from './geometry';
import { f32 as f, lround } from './numeric';
import { breedOf, lairOf, monsterBite, steps } from './town-monsters';
import { raidDue, raidKind, raidWarning } from './raid-progression';
import { combatRules } from './combat-events';
import { gateSealed, sealable } from './gate-seals';
import { Season, type Calendar } from './town-models';
import { planRaiderApproach, separateMonsters } from './monster-navigation';
import { choosePrey, rankPace, tauntedBy } from './monster-ranks';
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
  advanceRealm(dt: number): void;
  defendSettlement(dt: number): void;
  realmKill(beast: Monster): void;
  tallyKill(beast: Monster): void;
  strikeDown(p: Person, cause: string, notice?: string): void;
  settlementOf(p: Person | Building): number;
  inRealm(p: Point): boolean;
  calendar(): Calendar;
}
export function stir(this: EncounterTown, dt: number): void {
  this.blows = this.blows.filter((h) => !(this.time - h.at > 2));
  this.events = this.events.filter((event) => !(this.time - event.at > combatRules.eventSeconds));
  this.wakeGiants();
  this.stirWildlife(dt);
  const fire = this.camp(),
    roaming = this.beasts.filter((m) => !m.raider && !m.giant() && !this.inRealm(m.home)).length;
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
  const due = raidDue(this.world.seed(), this.days, this.calendar().season === Season.Winter);
  if (fire && fire.built() && due && this.dayFraction() > f(0.3) && this.raidWarnedDay !== this.days) {
    this.raidWarnedDay = this.days;
    const gate = this.world
      .dungeons()
      .map((site, index) => ({ site, index }))
      .filter((g) => sealable(g.site) && g.site.discovered && !gateSealed(this, g.index))
      .sort((a, b) => distance(lairOf(a.site), fire.center) - distance(lairOf(b.site), fire.center))[0];
    if (gate) this.notify(raidWarning(raidKind(this.world.seed(), this.days), gate.site.name));
  }
  if (
    fire &&
    fire.built() &&
    this.dayFraction() > f(0.5) &&
    this.climate().night > f(0.6) &&
    this.raidedDay !== this.days
  ) {
    this.raidedDay = this.days;
    if (due) this.summonRaid();
  }
  const raidOn = this.raiding();
  this.defendSettlement(dt);
  for (const beast of this.beasts) {
    if (beast.health <= 0 || this.inRealm(beast.home)) continue;
    if (beast.giant() && (beast.insideLair || (!this.giantsAwake() && !beast.angry))) {
      this.roamGiant(beast, dt);
      continue;
    }
    const breed = breedOf(this.world.dungeons()[beast.lair].kind);
    const scent = beast.raider ? 9 : beast.angry ? 7 : 4;
    let prey = tauntedBy(this, beast, scent * 1.5) ?? undefined;
    if (!prey)
      prey =
        choosePrey(
          beast,
          this.folk.filter(
            (p) =>
              (!beast.giant() || (p.id === beast.provokedBy && distance(p.position, beast.home) <= 7)) &&
              !p.inside &&
              p.health > 0 &&
              p.downedAt < 0 &&
              distance(p.position, beast.position) < scent,
          ),
        ) ?? undefined;
    if (prey) {
      const gap = distance(prey.position, beast.position);
      beast.path = [];
      beast.prey = -1;
      if (gap > f(0.7)) {
        let next = add(
          beast.position,
          scale(
            normalized(sub(prey.position, beast.position)),
            Math.min(gap, f(f(breed.speed * f(0.8) * rankPace(beast)) * f(dt))),
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
        monsterBite(this, beast, prey, breed);
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
    let step = f((beast.raider ? f(breed.speed * f(0.8) * rankPace(beast)) : f(0.5)) * f(dt));
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
    this.tallyKill(beast);
    if (this.inRealm(beast.home)) {
      this.realmKill(beast);
      continue;
    }
    const bounty = lround(
        f(breedOf(this.world.dungeons()[beast.lair].kind).health * (beast.raider ? f(0.5) : f(0.4))),
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
    ++this.chronicle.raidsRepelled;
    this.notify(`The raid is beaten off (${this.raidKills} slain, +${this.raidBounty} gold)`);
    this.raidKills = this.raidBounty = 0;
  }
  this.advanceRealm(dt);
}
