import { canControl } from './faction';
// Native town_monsters.cpp combat, raids, expeditions and damage. Native RNG order is retained.
import { TownState } from './town-state';
import { Person, Monster, Expedition, Role, Calling, Activity, adventurer } from './person';
import { Building, Check } from './town-models';
import { Structure, Resources, isSeat, structureSpec, describe } from './building-catalog';
import { Dungeon, DungeonKind, impassable } from './world-types';
import { WorldMap } from './world-map';
import { Point, point, add, sub, scale, normalized, rotated, distance } from './geometry';
import { f32 as f, lround } from './numeric';
import { CampEconomy } from './camp-economy';
import { animalSpec } from './wildlife';
import { spreadFighter } from './person-navigation';
import { planRaiderApproach } from './monster-navigation';
import { dungeonThreat } from './raid-progression';
import { attackDamage, attackReach, armorProtection } from './equipment';
export interface CombatTown extends TownState {
  walk(p: Person, dt: number): void;
  reveal(x: number, y: number, radius: number): void;
  walkTo(p: Person, at: Point): boolean;
  staffed(kind: Structure): boolean;
  camp(id?: number): Building | null;
  canSendExpedition(ids: number[], dungeon: number): Check;
  walkTo(p: Person, at: Point): boolean;
  power(p: Person): number;
  settlementOf(p: Person | Building): number;
  settlementAt(at: Point): number;
  credit(gain: Resources, village: number): void;
  store(gain: Resources, village: number): void;
  rewardExperience(p: Person, points: number): void;
  creatureTarget(id: number): Monster | null;
  strike(p: Person, foe: Monster): void;
  hurtGuest(p: Person, killed: boolean): void;
  raiding(): boolean;
  arrive(p: Person): void;
  resumeOrder(p: Person): boolean;
  changeRenown(village: number, amount: number): void;
  raze(id: number): void;
}
export const lairOf = (site: Dungeon): Point => point(f(site.origin.x + 1), f(site.origin.y + 1));
export const monsterEntrance = (site: Dungeon): Point =>
  point(f(site.origin.x + 1), f(site.origin.y + f(2.3)));
export interface Breed {
  health: number;
  bite: number;
  speed: number;
  pause: number;
}
export function breedOf(kind: DungeonKind): Breed {
  switch (kind) {
    case DungeonKind.Cave:
      return { health: f(4.5), bite: f(0.055), speed: f(1.45), pause: 1 };
    case DungeonKind.Crypt:
      return { health: 7, bite: f(0.045), speed: f(0.9), pause: f(1.3) };
    case DungeonKind.Portal:
      return { health: f(3.5), bite: f(0.08), speed: f(1.25), pause: f(0.9) };
    case DungeonKind.Ruin:
      return { health: f(5.5), bite: f(0.05), speed: f(1.1), pause: 1 };
    case DungeonKind.GiantHall:
      return { health: 24, bite: f(0.12), speed: f(0.85), pause: f(1.6) };
    default:
      return { health: 6, bite: f(0.08), speed: 1, pause: 1 };
  }
}
export function steps(map: WorldMap, to: Point): boolean {
  const tile = map.cell(to);
  return !!tile && !impassable(tile.terrain);
}
export const reachOf = (p: Person): number => f(attackReach(p));
export const blowOf = (p: Person): number => f(attackDamage(p));
export function power(this: CombatTown, p: Person): number {
  return f(attackDamage(p));
}
export function raiding(this: TownState): boolean {
  return this.beasts.some((m) => m.raider);
}
export function summonRaid(this: CombatTown): void {
  const fire = this.camp();
  if (!fire) return;
  let lair = -1;
  for (let d = 0; d < this.world.dungeons().length; ++d)
    if (
      this.world.dungeons()[d].kind !== DungeonKind.GiantHall &&
      this.world.dungeons()[d].discovered &&
      (lair < 0 ||
        distance(lairOf(this.world.dungeons()[d]), fire.center) <
          distance(lairOf(this.world.dungeons()[lair]), fire.center))
    )
      lair = d;
  if (lair < 0) return;
  const site = this.world.dungeons()[lair],
    prowling = this.beasts.filter((m) => m.raider).length,
    pressure = dungeonThreat(this.days, lairOf(site), this.placed),
    count = Math.min(pressure.count, TownState.maxRaiders - prowling);
  if (count <= 0) return;
  for (let i = 0; i < count; ++i) {
    const beast = new Monster(
      this.nextMonster++,
      lair,
      this.grid.nearestWalkable(add(monsterEntrance(site), rotated(point(0.6, 0), f(i * f(1.3))))),
    );
    beast.raider = true;
    beast.health = f(breedOf(site.kind).health * pressure.health);
    beast.strength = pressure.damage;
    this.beasts.push(beast);
    planRaiderApproach(this, beast);
  }
  ++this.raidCount;
  this.notify('Monsters from ' + site.name + ' raid the settlement!');
}
export function canSendExpedition(this: CombatTown, ids: number[], dungeon: number): Check {
  const check = new Check();
  if (dungeon < 0 || dungeon >= this.world.dungeons().length || !this.world.dungeons()[dungeon].discovered) {
    check.reason = 'No known dungeon there';
    return check;
  }
  if (this.world.dungeons()[dungeon].kind === DungeonKind.GiantHall) {
    check.reason = 'A neutral giant dwelling';
    return check;
  }
  const any = this.folk.some(
    (p) => canControl(p, this.controlFaction) && ids.includes(p.id),
  );
  if (!any) {
    check.reason = 'Select residents to send';
    return check;
  }
  check.ok = true;
  return check;
}
export function sendExpedition(this: CombatTown, ids: number[], dungeon: number): boolean {
  if (!this.canSendExpedition(ids, dungeon).ok) return false;
  const party: Expedition = { dungeon, members: [], returnAt: -1 };
  for (const p of this.folk) {
    if (!canControl(p, this.controlFaction) || !ids.includes(p.id)) continue;
    if (!this.walkTo(p, monsterEntrance(this.world.dungeons()[dungeon]))) continue;
    p.activity = Activity.Expedition;
    p.target = dungeon;
    p.ordered = false;
    p.task = Activity.Idle;
    party.members.push(p.id);
  }
  if (!party.members.length) return false;
  this.open[dungeon] = 1;
  this.parties.push(party);
  this.notify(party.members.length + ' set out for ' + this.world.dungeons()[dungeon].name);
  ++this.changes;
  return true;
}
export function returnFrom(this: CombatTown, party: Expedition): void {
  const site = this.world.dungeons()[party.dungeon];
  while (this.depth.length < this.world.dungeons().length) this.depth.push(0);
  let danger = f(f(5 + site.kind) + this.depth[party.dungeon] * 2);
  const fire = this.camp();
  if (fire) danger = f(danger + f(distance(lairOf(site), fire.center) / 25));
  let strength = 0;
  for (const id of party.members) {
    const p = this.person(id);
    if (p) strength = f(strength + this.power(p));
  }
  const won = f(strength * f(f(0.6) + f(this.roll() * f(0.8)))) >= danger;
  let outcome: string;
  if (won) {
    const loot = new Resources(
        Math.trunc(f(12 * danger)),
        0,
        Math.trunc(f(2 * danger)),
        0,
        site.kind === DungeonKind.Portal || site.kind === DungeonKind.Crypt ? Math.trunc(f(3 * danger)) : 0,
      ),
      shares = new Map<number, number>();
    let total = 0;
    for (const id of party.members) {
      const member = this.person(id);
      if (member) {
        const village = this.settlementOf(member);
        shares.set(village, (shares.get(village) ?? 0) + 1);
        ++total;
      }
    }
    let assigned = 0;
    for (const [village, members] of [...shares].sort((a, b) => a[0] - b[0])) {
      const share = (amount: number): number =>
        Number(
          (BigInt(amount) * BigInt(assigned + members)) / BigInt(total) -
            (BigInt(amount) * BigInt(assigned)) / BigInt(total),
        );
      this.credit(
        new Resources(
          share(loot.gold),
          share(loot.wood),
          share(loot.stone),
          share(loot.food),
          share(loot.mana),
          share(loot.water),
        ),
        village,
      );
      assigned += members;
    }
    ++this.depth[party.dungeon];
    outcome = 'The expedition returns from ' + site.name + ' with ' + describe(loot);
  } else outcome = 'The expedition is driven out of ' + site.name;
  this.notify(outcome);
  for (const p of this.folk) {
    if (!party.members.includes(p.id)) continue;
    p.health = f(
      p.health -
        f(
          f(
            (won ? f(this.roll() * f(0.25)) : f(f(0.3) + f(this.roll() * f(0.4)))) *
              (this.staffed(Structure.Apothecary) ? f(0.6) : 1),
          ) / p.vitalityMultiplier(),
        ),
    );
    p.stress = Math.min(1, f(p.stress + (won ? f(0.05) : f(0.25))));
    p.inside = false;
    p.activity = Activity.Idle;
    p.until = this.time;
    if (p.health <= 0) {
      this.notify(p.name + ' fell in ' + site.name);
      p.activity = Activity.Leaving;
      p.health = -1;
    } else if (won) this.rewardExperience(p, lround(f(danger * 6)));
  }
  party.members = [];
}
export function monsterAt(this: TownState, p: Point, reach: number): number {
  let best: Monster | null = null;
  for (const group of [this.beasts, this.animals])
    for (const beast of group)
      if (
        !beast.insideLair &&
        beast.health > 0 &&
        distance(beast.position, p) <= reach &&
        (!best || distance(beast.position, p) < distance(best.position, p))
      )
        best = beast;
  return best?.id ?? -1;
}
export function rewardExperience(this: TownState, p: Person, points: number): void {
  if (p.gainExperience(points) > 0) this.notify(p.name + ' reached level ' + p.level + '!');
}
export function strike(this: CombatTown, p: Person, foe: Monster): void {
  if (foe.health <= 0 || foe.insideLair) return;
  const blow = blowOf(p);
  foe.health = f(foe.health - blow);
  if (foe.animal !== null && (!foe.angry || foe.health <= 0))
    this.animalCalls.push({
      serial: this.nextAnimalCall++,
      kind: foe.animal,
      position: { ...foe.position },
      at: this.time,
    });
  if ((foe.giant() || foe.animal !== null) && !foe.angry) foe.ready = this.time + 0.15;
  if (!foe.raider) foe.angry = true;
  if (foe.giant() || foe.animal !== null) foe.provokedBy = p.id;
  p.ready = this.time + 1;
  const ranged = reachOf(p) > 1;
  this.blows.push({
    serial: this.nextBlow++,
    from: { ...p.position },
    to: { ...foe.position },
    damage: lround(f(blow * 10)),
    onPerson: false,
    ranged,
    at: this.time,
    person: p.id,
    attacker: p.id,
  });
  if (foe.health <= 0) {
    if (foe.animal === null) {
      const remains = new Resources();
      remains.bones = foe.giant() ? 6 : 2;
      this.store(remains, this.settlementOf(p));
    }
    const health =
        foe.animal !== null
          ? animalSpec(foe.animal).health
          : breedOf(this.world.dungeons()[foe.lair].kind).health,
      points = lround(f(health * (foe.animal !== null ? 2 : foe.raider ? 4 : 3)));
    for (const ally of this.folk)
      if (
        ally.health > 0 &&
        (ally.id === p.id ||
          (!ally.inside && ally.activity === Activity.Fighting && distance(ally.position, foe.position) <= 6))
      )
        this.rewardExperience(ally, points);
  }
}
// Threats interrupt an order without replacing its task/site. When combat ends,
// the original move, resource or construction transaction resumes.
export function fight(this: CombatTown, p: Person, dt: number): void {
  if (
    p.faction !== this.controlFaction || p.stressRecovery || p.health <= 0 ||
    p.activity === Activity.Expedition || p.activity === Activity.Leaving || p.crossingDoorway()
  ) return;
  const notice = this.raiding() ? 10 : 5;
  const threats = [...this.beasts, ...this.animals].filter(m =>
    m.health > 0 && !m.insideLair && (!m.giant() || m.angry) &&
    (m.animal === null || (m.angry && animalSpec(m.animal).defends)) &&
    this.world.revealed(m.position) && distance(m.position, p.position) <= notice &&
    (m.raider || m.angry || distance(m.position,p.position) < 2.5));
  threats.sort((a,b) => distance(a.position,p.position)-distance(b.position,p.position) || a.id-b.id);
  let foe: Monster | null = threats.find(m => m.id === p.foe) ?? threats[0] ?? null;
  let person: Person | null = null;
  if (foe && p.hunting && foe.id !== p.foe) p.hunting = false;
  if (!foe && p.ordered && p.task === Activity.Fighting) {
    if (p.attackPerson >= 0) person = this.person(p.attackPerson);
    else foe = this.creatureTarget(p.taskSite);
  }
  if (!foe && !person && p.hunting) foe = this.creatureTarget(p.foe);
  if (foe && (foe.health <= 0 || foe.insideLair)) foe = null;
  if (person && (person.health <= 0 || person.id === p.id || person.activity === Activity.Leaving)) person = null;
  if (!foe && !person) {
    p.foe = -1;
    if (p.activity === Activity.Fighting || p.task === Activity.Fighting) {
      p.path = []; p.activity = Activity.Idle; p.until = this.time;
      // Combat borrows the movement path, including an automatic builder's
      // approach. Restore that transaction now: its approach marker otherwise
      // makes the scheduler wait forever for a path that combat discarded.
      // A dead explicit target completes immediately, without walking to its
      // obsolete click position. resumeOrder applies the normal return-to-Auto.
      if (p.task === Activity.Fighting) p.approachingOrder = false;
      this.resumeOrder(p);
    }
    return;
  }
  // Explicit Stop holds position, but does not make a resident ignore an attacker.
  const target = foe ?? person!, at = target.position, gap = distance(at,p.position);
  p.foe = foe?.id ?? -1;
  p.activity = Activity.Fighting;
  if (p.inside) {
    this.walkTo(p, at);
    return;
  }
  if (gap > reachOf(p)) {
    if (!p.path.length || distance(p.path[p.path.length-1],at) > .7) {
      if (!this.walkTo(p, at)) { p.foe = -1; p.activity = Activity.Idle; p.until = this.time + .5; return; }
    }
    this.walk(p,dt);
    if (!this.world.revealedWithin(p.position, f(3.5))) this.reveal(p.position.x,p.position.y,f(7.5));
    return;
  }
  p.path = [];
  spreadFighter(this,p,target,reachOf(p),dt);
  if (this.time < p.ready) return;
  if (foe) this.strike(p,foe);
  else {
    const damage = f(blowOf(p) * .1 * (1 - armorProtection(person!)) / person!.vitalityMultiplier());
    person!.health = f(person!.health - damage);
    p.ready = this.time + 1;
    this.blows.push({serial:this.nextBlow++,from:{...p.position},to:{...person!.position},damage:lround(damage*100),onPerson:true,ranged:reachOf(p)>1,at:this.time,person:person!.id,attacker:p.id});
    this.hurtGuest(person!,person!.health <= 0);
    if (person!.health <= 0) { person!.health = -1; person!.activity = Activity.Leaving; this.notify(person!.name + ' was killed'); }
  }
}
export function releaseMonster(this: CombatTown, at: Point): void {
  let lair = -1;
  for (let d = 0; d < this.world.dungeons().length; ++d)
    if (
      this.world.dungeons()[d].kind !== DungeonKind.GiantHall &&
      (lair < 0 ||
        distance(lairOf(this.world.dungeons()[d]), at) < distance(lairOf(this.world.dungeons()[lair]), at))
    )
      lair = d;
  if (lair < 0) return;
  const beast = new Monster(this.nextMonster++, lair, this.grid.nearestWalkable(at));
  const pressure = dungeonThreat(this.days, lairOf(this.world.dungeons()[lair]), this.placed);
  beast.health = f(breedOf(this.world.dungeons()[lair].kind).health * pressure.health);
  beast.strength = pressure.damage;
  beast.home = { ...beast.position };
  this.beasts.push(beast);
}
export function hurtGuest(this: CombatTown, p: Person, killed: boolean): void {
  if (p.role !== Role.Guest) return;
  this.changeRenown(this.settlementOf(p), killed ? -8 : f(-0.4));
  if (killed) this.notify("A guest was killed: the settlement's renown suffers");
}
export function wreck(this: CombatTown, beast: Monster, dt: number): void {
  const breed = breedOf(this.world.dungeons()[beast.lair].kind),
    match = this.network.distance(beast.position),
    lane = match.id ?? -1;
  if (match.distance < f(0.6) && lane >= 0) {
    const road = this.network.road(lane);
    if (road && road.built >= 1 && road.wear < 1) {
      road.wear = Math.min(1, f(road.wear + f(f(dt) * (road.paved ? f(0.012) : f(0.025)))));
      if (road.wear >= 1) {
        this.notify(road.paved ? 'Monsters tore up a paved road' : 'Monsters tore up a road');
        this.roadChanged();
      }
    }
  }
  if (this.time < beast.ready) return;
  const target = beast.raider ? this.building(beast.prey) : null;
  const nearby = target ? [target, ...this.placed.filter(item => item !== target)] : this.placed;
  for (const item of nearby) {
    if (!item.footprint().contains(beast.position, f(0.7))) continue;
    const blow = f(breed.bite * beast.strength * f(0.25));
    beast.ready = this.time + breed.pause;
    this.blows.push({
      serial: this.nextBlow++,
      from: { ...beast.position },
      to: { ...item.center },
      damage: Math.max(1, lround(f(blow * 100))),
      onPerson: true,
      ranged: false,
      at: this.time,
      person: -1,
    });
    if (!item.built()) {
      item.progress = f(item.progress - blow);
      if (item.progress <= 0) {
        this.notify('Monsters wrecked the ' + structureSpec(item.kind).name + ' site');
        this.raze(item.id);
      }
      return;
    }
    item.health = f(item.health - blow);
    if (isSeat(item.kind) && item.health < f(0.1)) item.health = f(0.1);
    else if (item.health <= 0) {
      this.notify('Monsters destroyed the ' + structureSpec(item.kind).name);
      this.raze(item.id);
    }
    return;
  }
}
