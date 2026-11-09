// Native town_people.cpp resident creation, navigation, housing and guest arrival rules.
import { TownState } from './town-state';
import { Building } from './town-models';
import { Person, Role, Race, Calling, Activity, adventurer, callingName } from './person';
import { Faith, Resources, Structure, isHome, isLodging, isSeat, structureSpec } from './building-catalog';
import { Point, point, add, sub, scale, rotated, distance } from './geometry';
import { f32 as f } from './numeric';
import { CampReceipt } from './camp-economy';
import { CharacterPreset, applyCharacter } from './character-preset';
import { sameFaction } from './faction';
export interface ResidentTown extends TownState {
  camp(id?: number): Building | null;
  settlementAt(at: Point): number;
  settlementOf(p: Person | Building): number;
  population(id?: number): number;
  housing(id?: number): number;
  guests(id?: number): number;
  guestBeds(id?: number): number;
  stock(id?: number): Resources;
  makePerson(role: Role, calling: Calling, at: Point): Person;
  refreshShelter(p: Person): void;
  walkingSpeed(p: Person): number;
  walkTo(p: Person, to: Point): boolean;
  gateway(village?: number): Point;
  assignHomes(): void;
  staff(): void;
  recordReceipt(receipt: CampReceipt): void;
  charge(p: Person, b: Building | null, gold: number): boolean;
  site(id: number): Building | null;
  shelterOf(p: Person): number;
  raiding(): boolean;
  welcome(calling: Calling, gate: Building | null, village: number): void;
  naturalize(p: Person): number;
  enforceGuestLodging(p: Person): void;
}
const humanNames = [
  'Arnbjorn',
  'Bera',
  'Dagny',
  'Eyvind',
  'Finna',
  'Geirmund',
  'Hauk',
  'Hallbera',
  'Hild',
  'Ingjald',
  'Jorun',
  'Kolbein',
  'Ottar',
  'Orm',
  'Rannveig',
  'Sigrid',
  'Skeggi',
  'Steinar',
  'Thorhild',
  'Vigdis',
];
const godNames = [
  'Baldr',
  'Idunn',
  'Tyr',
  'Eir',
  'Vidar',
  'Sif',
  'Forseti',
  'Nanna',
  'Bragi',
  'Syn',
  'Ullr',
  'Fulla',
];
export function customizePerson(this: ResidentTown, id: number, preset: CharacterPreset): boolean {
  for (const person of this.folk) if (person.id === id) return applyCharacter(person, preset);
  return false;
}
export function makePerson(this: ResidentTown, role: Role, calling: Calling, at: Point): Person {
  const race = this.roll() < f(0.08) ? Race.God : Race.Human,
    names = race === Race.God ? godNames : humanNames,
    called = names[Math.trunc(f(this.roll() * names.length)) % names.length],
    person = new Person(
      this.nextPerson++,
      called,
      role,
      calling,
      race,
      Math.trunc(f(this.roll() * f(1e6))) >>> 0,
      { ...at },
    );
  person.faction = this.controlFaction;
  person.faith = person.look % Faith.Count;
  person.purse = 10;
  return person;
}
export function workHours(this: ResidentTown): boolean {
  return this.climate().night < f(0.2);
}
export function nearest(this: ResidentTown, from: Point, match: (b: Building) => boolean): Building | null {
  let best: Building | null = null;
  for (const item of this.placed)
    if (match(item) && (!best || distance(item.center, from) < distance(best.center, from))) best = item;
  return best;
}
export function site(this: ResidentTown, id: number): Building | null {
  return this.placed.find((item) => item.id === id) ?? null;
}
export function walkTo(this: ResidentTown, p: Person, to: Point): boolean {
  this.refreshShelter(p);
  const from = p.inside || p.doorway > 0 ? p.entrance : p.position,
    path = this.grid.path(from, to);
  if (!path.length) return false;
  p.path = path.slice(1);
  p.inside = false;
  return true;
}
// The command target may already be another building; recover the actual occupied shelter.
export function refreshShelter(this: ResidentTown, p: Person): void {
  if (!p.inside || p.doorway < 1 || p.activity === Activity.Exploring || p.activity === Activity.Expedition)
    return;
  const place = this.building(this.shelterOf(p));
  if (place) {
    p.entrance = place.door();
    p.threshold = place.threshold();
    p.position = { ...p.threshold };
  }
}
export function walkingSpeed(this: ResidentTown, p: Person): number {
  let speed = this.grid.speedAt(p.position);
  speed = f(speed * f(1 - f(f(0.35) * this.climate().snow)));
  if (p.health < f(0.4)) speed = f(speed * f(0.7));
  return speed;
}
export function walk(this: ResidentTown, p: Person, dt: number): void {
  let step = f(this.walkingSpeed(p) * f(dt));
  while (step > 0 && p.path.length) {
    const next = p.path[0],
      gap = distance(p.position, next);
    if (gap <= step) {
      p.position = { ...next };
      p.path.shift();
      step = f(step - gap);
    } else {
      p.position = add(p.position, scale(sub(next, p.position), f(step / gap)));
      step = 0;
    }
  }
}
export function gateway(this: ResidentTown, village = -1): Point {
  const seat = village < 0 ? this.camp() : this.camp(village);
  village = seat?.id ?? -1;
  const from = seat ? seat.center : this.world.camp();
  let best = from;
  for (const road of this.network.roads())
    if (road.village === village)
      for (const end of [road.line[0], road.line[road.line.length - 1]])
        if (distance(end, from) > distance(best, from)) best = end;
  if (distance(best, from) > 6) return { ...best };
  const door = seat ? seat.door() : from,
    middle = point(f(this.world.width() / 2), f(this.world.height() / 2)),
    heading = f(Math.atan2(f(middle.y - from.y), f(middle.x - from.x)));
  for (let turn = 0; turn < 12; ++turn) {
    const at = this.grid.nearestWalkable(
      add(from, rotated(point(14, 0), f(heading + f(turn * f(0.5235988))))),
    );
    if (this.grid.path(door, at).length) return at;
  }
  return door;
}
export function assignHomes(this: ResidentTown): void {
  const accepts = (kind: Structure, role: Role): boolean =>
    role === Role.Resident ? isHome(kind) : isLodging(kind);
  const room = (home: Building, role: Role): number => {
    const used = this.folk.filter(
      (p) =>
        p.health > 0 &&
        sameFaction(p, home) &&
        (role === Role.Resident ? p.home === home.id : p.bed === home.id),
    ).length;
    return (
      (role === Role.Resident ? structureSpec(home.kind).residents : structureSpec(home.kind).beds) - used
    );
  };
  for (const p of this.folk) {
    const slot = p.role === Role.Resident ? 'home' : 'bed',
      current = this.building(p[slot]);
    if (current?.built() && current.health > 0 && sameFaction(current, p) && accepts(current.kind, p.role))
      continue;
    p[slot] = -1;
    let seat = this.camp(p.village);
    if (!seat || !sameFaction(seat, p)) {
      seat = null;
      for (const candidate of this.placed)
        if (
          isSeat(candidate.kind) &&
          sameFaction(candidate, p) &&
          (!seat || distance(candidate.center, p.position) < distance(seat.center, p.position))
        )
          seat = candidate;
    }
    const village = seat?.id ?? -1;
    if (village < 0) continue;
    let best: Building | null = null;
    for (const item of this.placed) {
      if (
        !item.built() ||
        item.health <= 0 ||
        !sameFaction(item, p) ||
        !accepts(item.kind, p.role) ||
        this.settlementOf(item) !== village ||
        room(item, p.role) <= 0 ||
        (p.role === Role.Resident && isSeat(item.kind))
      )
        continue;
      if (!best || distance(item.center, p.position) < distance(best.center, p.position)) best = item;
    }
    if (best) p[slot] = best.id;
    else if (p.role === Role.Resident && seat?.built() && room(seat, Role.Resident) > 0) p.home = seat.id;
  }
}
export function bardPlaying(this: ResidentTown): boolean {
  return this.folk.some(
    (p) =>
      p.calling === Calling.Bard &&
      p.health > 0 &&
      p.activity !== Activity.Leaving &&
      p.activity !== Activity.Expedition,
  );
}
/** Lodging attracts paying visitors; neither a guild nor a spare resident bed does. */
export function admitGuests(this: ResidentTown, dt: number): void {
  if (this.raiding()) return;
  for (const village of this.villages) {
    const seat = this.camp(village.camp);
    if (!seat?.built()) continue;
    let gate: Building | null = null,
      tavern = false,
      lodging = false;
    for (const b of this.placed) {
      if (!b.built() || !sameFaction(b, seat) || this.settlementOf(b) !== village.camp) continue;
      lodging ||= isLodging(b.kind);
      tavern ||= b.kind === Structure.Tavern;
      if (
        b.kind === Structure.Portal &&
        (!gate || distance(b.center, seat.center) < distance(gate.center, seat.center))
      )
        gate = b;
    }
    const room = (): boolean => lodging && this.guests(village.camp) < this.guestBeds(village.camp);
    const bard = this.folk.some(
      (p) =>
        p.role === Role.Guest &&
        p.calling === Calling.Bard &&
        p.health > 0 &&
        p.activity !== Activity.Leaving &&
        this.settlementOf(p) === village.camp,
    );
    if (!tavern || !room() || bard) village.bardDue = -1;
    else if (village.bardDue < 0)
      village.bardDue = this.time + TownState.secondsPerDay * (0.15 + this.roll() * 0.2);
    else if (this.time >= village.bardDue) {
      village.bardDue = -1;
      this.welcome(Calling.Bard, gate, village.camp);
    }
    village.arrivalTimer -= dt / TownState.secondsPerDay;
    if (village.arrivalTimer > 0) continue;
    village.arrivalTimer = (1.8 + this.roll() * 1.6) * (1.5 - village.renown / 100) * (gate ? 0.55 : 1);
    if (room()) this.welcome(Calling.Traveller, gate, village.camp);
  }
}
export function enter(person: Person, threshold: Point): void {
  person.entrance = { ...person.position };
  person.threshold = { ...threshold };
  person.doorway = 0;
  person.inside = true;
}
export function welcome(this: ResidentTown, calling: Calling, gate: Building | null, village: number): void {
  const seat = this.camp(village);
  if (!seat?.built() || this.guests(village) >= this.guestBeds(village)) return;
  const lodging = this.placed.filter(
    (b) => b.built() && sameFaction(b, seat) && isLodging(b.kind) && this.settlementOf(b) === village,
  );
  if (!lodging.length) return;
  if (
    gate &&
    (!gate.built() ||
      gate.kind !== Structure.Portal ||
      !sameFaction(gate, seat) ||
      this.settlementOf(gate) !== village)
  )
    gate = null;
  const guest = this.makePerson(Role.Guest, calling, gate ? gate.door() : this.gateway(village));
  guest.village = village;
  guest.faction = seat.faction;
  if (gate) {
    enter(guest, gate.threshold());
    guest.doorway = 1;
    guest.position = { ...guest.threshold };
  }
  const fighter = adventurer(guest);
  guest.food = f(0.9);
  guest.purse =
    (fighter ? 25 + Math.trunc(f(this.roll() * 25)) : 15 + Math.trunc(f(this.roll() * 20))) + (gate ? 10 : 0);
  guest.activity = Activity.Arriving;
  this.charge(guest, seat, fighter ? 5 : 3);
  let stop: Building | null = null;
  for (const b of this.placed)
    if (
      b.built() &&
      sameFaction(b, seat) &&
      this.settlementOf(b) === village &&
      (calling === Calling.Bard ? b.kind === Structure.Tavern : isLodging(b.kind)) &&
      (!stop || distance(b.center, guest.position) < distance(stop.center, guest.position))
    )
      stop = b;
  stop ??= lodging[0];
  if (isLodging(stop.kind)) guest.bed = stop.id;
  this.walkTo(guest, stop.door());
  const what =
    calling === Calling.Traveller
      ? 'a traveller'
      : calling === Calling.Bard
        ? 'a bard'
        : 'an adventurer (' + callingName(calling) + ')';
  this.notify(
    guest.name +
      ', ' +
      what +
      ', arrives' +
      (gate ? ' through the portal' : '') +
      (calling === Calling.Bard ? ' to play at the tavern' : ''),
  );
  this.folk.push(guest);
  this.assignHomes();
  this.recordReceipt(new CampReceipt(0n, village, new Resources(), 0, 0, 0, 1));
  ++this.changes;
}
/** Kept as inert save/script compatibility entry points: visitors never become residents. */
export function settleGuests(this: ResidentTown): void {}
export function naturalize(this: ResidentTown, _p: Person): number {
  return 0;
}
export function bestow(this: ResidentTown, id: number, gold: number): void {
  for (const p of this.folk) if (p.id === id) p.purse += gold;
}
export function recruit(this: ResidentTown, role: Role, calling: Calling, count: number, village = -1): void {
  const seat = village < 0 ? this.camp() : this.camp(village),
    at = seat ? seat.door() : this.world.camp(),
    first = this.folk.length;
  for (let i = 0; i < count; ++i) {
    const person = this.makePerson(
      role,
      calling,
      this.grid.nearestWalkable(add(at, rotated(point(0.7, 0), f(i * f(1.3))))),
    );
    person.village = seat?.id ?? -1;
    person.faction = seat?.faction ?? this.controlFaction;
    this.folk.push(person);
  }
  this.assignHomes();
  this.staff();
  for (let i = first; i < this.folk.length; ++i)
    this.recordReceipt(
      new CampReceipt(
        0n,
        this.settlementOf(this.folk[i]),
        new Resources(),
        0,
        0,
        role === Role.Resident ? 1 : 0,
        role === Role.Guest ? 1 : 0,
      ),
    );
  ++this.changes;
}
export function settle(this: ResidentTown, _id: number): boolean {
  return false;
}
