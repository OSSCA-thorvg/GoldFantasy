// The title's camera: picks what is worth watching (a fight, the party beyond a gate, Thor, a building going up,
// a craft at a station, a prayer), holds it for a while, follows it as it moves, and glides to the next one.
// It only ever looks at living, outdoor subjects on revealed land.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Role, type Person } from '../../../../packages/engine/src/person';
import { Camera, distance, point, project, unproject, type Point } from '../../../../packages/engine/src/geometry';
import { Weather } from '../../../../packages/engine/src/climate';
import { MonsterRank } from '../../../../packages/engine/src/combat-events';
import { TownState } from '../../../../packages/engine/src/town-state';
import { isPlayerBuilding, isPlayerResident } from '../../../../packages/engine/src/faction';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { stepGlide, type CameraGlide } from './camera-glide';

export interface Subject {
  key: string;
  /** What the overlay says the camera is on. */
  label: string;
  interest: number;
  at: Point;
  /** The resident followed, when the subject is one. */
  person: Person | null;
  zoom: number;
}
export const directorRules = {
  /** Seconds a subject is held before another may take the view. */
  hold: 7,
  /** Seconds after which the same subject gives way to anything else worth watching. */
  most: 22,
  /** A subject this much more interesting cuts in before the hold is over. */
  urgent: 35,
  /** Seconds between looks around for subjects. */
  scan: 0.5,
  /** Farther than this in tiles the camera cuts instead of gliding over unexplored ground. */
  glideReach: 28,
  zoom: 1.2,
};
const f = Math.fround;
const outdoors = (p: Person): boolean => p.health > 0 && !p.inside && !p.crossingDoorway();
const centroid = (points: readonly Point[]): Point =>
  points.reduce((c, p) => point(c.x + p.x / points.length, c.y + p.y / points.length), point());

/** True when the camera may look at `at`: on the map and on land the settlement has seen. */
export function watchable(town: Town, at: Point): boolean {
  const map = town.map();
  return Number.isFinite(at.x) && Number.isFinite(at.y) && map.inside(at) && map.revealed(at);
}
/** Everything worth watching right now, most interesting first. */
export function subjects(town: Town): Subject[] {
  const out: Subject[] = [],
    zoom = directorRules.zoom,
    folk = town.people().filter((p) => isPlayerResident(p) && p.role === Role.Resident && outdoors(p) && p.downedAt < 0),
    seat = town.camp();
  const add = (s: Subject) => {
    if (watchable(town, s.at)) out.push(s);
  };
  if (town.realmActive()) {
    const standing = town.realmStanding().filter(outdoors);
    if (standing.length) {
      const fighting = standing.find((p) => p.activity === Activity.Fighting) ?? standing[0];
      add({ key: 'realm', label: 'Beyond the gate', interest: 100, at: centroid(standing.map((p) => p.position)), person: fighting, zoom: f(1.05) });
    }
  }
  const walking = folk.filter((p) => p.activity === Activity.Expedition);
  if (walking.length)
    add({ key: 'march', label: 'Marching to the gate', interest: 80, at: walking[0].position, person: walking[0], zoom });
  if (seat) {
    const raiders = town
      .monsters()
      .filter((m) => m.health > 0 && (m.raider || m.angry) && m.rank !== MonsterRank.Den && !town.inRealm(m.position))
      .filter((m) => distance(m.position, seat.center) < TownState.campReach * 2);
    if (raiders.length) {
      const front = raiders.sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center))[0],
        defender = folk
          .filter((p) => p.activity === Activity.Fighting)
          .sort((a, b) => distance(a.position, front.position) - distance(b.position, front.position))[0];
      add({ key: 'raid', label: 'A raid on the settlement', interest: 90, at: defender?.position ?? front.position, person: defender ?? null, zoom: f(1.1) });
    }
  }
  if (town.thor.present) add({ key: 'thor', label: 'Thor walks among them', interest: 70, at: town.thor.position, person: null, zoom });
  for (const p of folk) {
    if (p.activity === Activity.Praying) add({ key: `pray:${p.id}`, label: `${p.name} prays at the altar`, interest: 60, at: p.position, person: p, zoom });
    else if (p.activity === Activity.Crafting) add({ key: `craft:${p.id}`, label: `${p.name} works at the bench`, interest: 45, at: p.position, person: p, zoom });
    else if (p.activity === Activity.Tending) add({ key: `tend:${p.id}`, label: `${p.name} tends the fallen`, interest: 65, at: p.position, person: p, zoom });
  }
  for (const b of town.buildings()) {
    if (!isPlayerBuilding(b) || b.built()) continue;
    const builder = folk.find((p) => p.activity === Activity.Building && p.target === b.id);
    if (builder)
      add({ key: `site:${b.id}`, label: `Raising a ${structureSpec(b.kind).name.toLowerCase()}`, interest: 50, at: builder.position, person: builder, zoom });
  }
  const work = [Activity.Felling, Activity.Mining, Activity.Working, Activity.Roadwork, Activity.Hauling];
  for (const p of folk)
    if (work.includes(p.activity) && !town.inRealm(p.position))
      add({ key: `work:${p.id}`, label: `${p.name} at work`, interest: 20 + (p.id % 7), at: p.position, person: p, zoom });
  if (seat) {
    const storm = town.climate().weather === Weather.Storm;
    add({ key: 'settlement', label: storm ? 'A storm over the settlement' : 'The settlement', interest: storm ? 40 : 5, at: seat.center, person: null, zoom: f(storm ? 1 : 1.1) });
  } else if (folk.length)
    add({ key: `walk:${folk[0].id}`, label: `Following ${folk[0].name}`, interest: 10, at: folk[0].position, person: folk[0], zoom });
  return out.sort((a, b) => b.interest - a.interest);
}
export class TitleDirector {
  private view = new Camera();
  private ready = false;
  private current: Subject | null = null;
  private since = 0;
  private scanAt = -1;
  private glide: CameraGlide | null = null;
  private clock = 0;
  /** Recently held subjects, so the view moves on to something new. */
  private seen = new Map<string, number>();
  reset(): void {
    this.ready = false;
    this.current = null;
    this.glide = null;
    this.scanAt = -1;
    this.seen.clear();
  }
  subject(): Subject | null {
    return this.current;
  }
  focusLabel(): string {
    return this.current?.label ?? '';
  }
  /** Picks the subject for this moment; the current one is kept while it is valid and its hold lasts. */
  private choose(town: Town): void {
    const list = subjects(town),
      held = this.clock - this.since,
      fresh = this.current && list.find((s) => s.key === this.current!.key);
    if (fresh) this.current = fresh;
    else this.current = null;
    const best = list.find((s) => !this.current || s.key !== this.current.key),
      recent = (s: Subject) => this.clock - (this.seen.get(s.key) ?? -1e9) < directorRules.most * 2;
    const next = list.find((s) => s !== this.current && !recent(s) && (!this.current || s.key !== this.current.key)) ?? best;
    if (!this.current) {
      this.cut(list[0] ?? null);
      return;
    }
    if (!next) return;
    if (next.interest >= this.current.interest + directorRules.urgent && held >= 1.5) this.cut(next);
    else if (held >= directorRules.hold && next.interest >= this.current.interest - 10 && next.key !== this.current.key) this.cut(next);
    else if (held >= directorRules.most && next.key !== this.current.key) this.cut(next);
  }
  private cut(next: Subject | null): void {
    if (this.current) this.seen.set(this.current.key, this.clock);
    this.current = next;
    this.since = this.clock;
    this.glide = null;
  }
  /** The camera for this frame; `seconds` is title time passed since the last frame. */
  update(town: Town, width: number, height: number, seconds: number, reducedMotion = false): Camera {
    this.clock += Math.max(0, Math.min(0.25, seconds));
    const before = this.current?.key;
    if (this.clock >= this.scanAt) {
      this.scanAt = this.clock + directorRules.scan;
      this.choose(town);
    } else if (this.current && !this.still(town, this.current)) this.choose(town);
    const subject = this.current,
      at = subject ? (subject.person && this.still(town, subject) ? subject.person.position : subject.at) : (town.camp()?.center ?? town.map().camp()),
      zoom = subject?.zoom ?? directorRules.zoom,
      projected = project(at.x, at.y, 12),
      target = point(f(projected.x + f(f(width * f(0.15)) / zoom)), f(projected.y - f(f(height * f(0.08)) / zoom)));
    if (!this.ready || reducedMotion) {
      this.view = new Camera(target.x, target.y, zoom);
      this.ready = true;
      return new Camera(this.view.x, this.view.y, this.view.zoom);
    }
    if (subject && subject.key !== before) {
      const from = point(this.view.x, this.view.y),
        tiles = distance(at, this.worldOf(width, height));
      // A long way over sea or fog is a cut, not a flight across black.
      if (tiles > directorRules.glideReach) this.view = new Camera(target.x, target.y, zoom);
      else this.glide = { from, to: target, start: this.clock, seconds: Math.min(2.4, 1 + tiles / 20) };
    }
    if (this.glide) {
      this.glide.to = target;
      if (!stepGlide(this.view, this.glide, this.clock)) this.glide = null;
    } else {
      const ease = f(1 - Math.exp(-Math.max(0, Math.min(0.25, seconds)) / 0.45));
      this.view.x = f(this.view.x + f(f(target.x - this.view.x) * ease));
      this.view.y = f(this.view.y + f(f(target.y - this.view.y) * ease));
    }
    const zoomEase = f(1 - Math.exp(-Math.max(0, Math.min(0.25, seconds)) / 0.8));
    this.view.zoom = f(this.view.zoom + f(f(zoom - this.view.zoom) * zoomEase));
    return new Camera(this.view.x, this.view.y, this.view.zoom);
  }
  /** The followed resident, when the subject is one and still worth following. */
  person(town: Town): Person | null {
    const p = this.current?.person;
    return p && this.still(town, this.current!) ? p : null;
  }
  /** The subject is still alive, outdoors and on revealed land. */
  still(town: Town, s: Subject): boolean {
    const p = s.person;
    if (p && (!outdoors(p) || p.downedAt >= 0 || !town.people().includes(p))) return false;
    return watchable(town, p ? p.position : s.at);
  }
  /** Where in the world the view looks now, without the title's framing offset. */
  private worldOf(width: number, height: number): Point {
    const zoom = this.view.zoom || 1,
      x = this.view.x - (width * 0.15) / zoom,
      y = this.view.y + (height * 0.08) / zoom;
    return unproject(x, y + 12);
  }
}
