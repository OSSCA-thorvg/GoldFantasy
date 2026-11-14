// Reading a swarm: how many dens and monsters a floor still holds, a den falling and the brood breaking as wins,
// a raid wave with its size and an arrow at the screen edge, and what a floor holds before a party goes in.
import { Rect, Align } from '../../../../packages/native-ui/src';
import { CombatCue, MonsterRank, type CombatEvent } from '../../../../packages/engine/src/combat-events';
import { distance, project, sub, type Point } from '../../../../packages/engine/src/geometry';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { realmRules } from '../../../../packages/engine/src/town-realm';
import { lairOf } from '../../../../packages/engine/src/town-monsters';
import type { Town } from '../../../../packages/engine/src/town';
import { controllableIds } from './game-control';
import { canControl } from '../../../../packages/engine/src/faction';
import { skillOfCalling } from '../../../../packages/engine/src/skill-catalog';
import type { Person } from '../../../../packages/engine/src/person';
import type { GameAppState } from './game-app-state';
import type { GameHudApp } from './game-hud-contract';

/** Level a party of six should have for each floor (realm-balance tests hold the engine to these). */
export const recommendedLevel = [4, 8, 12];
const bannerSeconds = 3.5;
const waveSeconds = 8;
export interface SwarmCount {
  dens: number;
  /** Dens the floor had; at least the living ones. */
  total: number;
  monsters: number;
}
export function swarmCount(app: GameAppState): SwarmCount | null {
  const town = app.town;
  if (!town.realmActive()) return null;
  const army = app.army,
    dens = town.realmDens().length;
  if (army.realmRevision !== town.realmRevision) {
    army.realmRevision = town.realmRevision;
    army.densSeen = 0;
  }
  army.densSeen = Math.max(army.densSeen, dens);
  const monsters = town.realmFoes().filter((m) => m.rank !== MonsterRank.Den).length;
  return { dens, total: army.densSeen, monsters };
}
export const swarmLine = (count: SwarmCount): string =>
  `Dens ${count.dens} of ${count.total}  ·  Monsters ${count.monsters}`;
/** Words for a screen direction from `from` toward `to`, north being up. */
export function wayTo(from: Point, to: Point): string {
  const toward = sub(project(to.x, to.y), project(from.x, from.y)),
    angle = (Math.atan2(toward.y, toward.x) * 180) / Math.PI,
    ways = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return ways[Math.round((angle < 0 ? angle + 360 : angle) / 45) % 8];
}
/** Hears the swarm cues the combat frame passes on: den and brood banners, and the raid wave. */
export function swarmFrame(app: GameAppState, heard: readonly CombatEvent[]): void {
  // The banners are timed on the clock they are drawn by; the game's own seconds run apart from it.
  const army = app.army,
    town = app.town,
    seconds = app.context.time();
  if (army.town !== town) army.banners = [];
  for (const e of heard) {
    if (e.cue === CombatCue.DenDestroyed) {
      const left = town.realmActive() ? town.realmDens().length : town.dens().length,
        count = swarmCount(app),
        killer = town.person(e.person);
      army.banners.push({
        title: left ? 'A den is destroyed' : 'The last den is destroyed',
        detail:
          (killer ? `${killer.name} struck the last blow. ` : '') +
          (left ? `${left} of ${count?.total ?? left + 1} still ${left === 1 ? 'breeds' : 'breed'}.` : 'No more will climb out.'),
        until: seconds + bannerSeconds,
      });
    } else if (e.cue === CombatCue.BroodBreak)
      army.banners.push({
        title: 'The brood breaks',
        detail: `${e.amount} ${e.amount === 1 ? 'monster dies' : 'monsters die'} with their dens. The floor is clear.`,
        until: seconds + bannerSeconds + 1,
      });
    else if (e.cue === CombatCue.Wave) army.wave = { size: e.amount, from: { ...e.position }, at: town.clock() };
  }
  army.banners = army.banners.filter((b) => b.until > seconds).slice(-3);
}
/** The engine's own notices for these moments are left to the banners. */
export const bannerNotice = (text: string): boolean =>
  /^A den is destroyed \(\d+ left\)$/.test(text) || /^What was left of the brood dies with it/.test(text);
function column(width: number): { x: number; w: number } {
  const w = Math.min(390, f32(width - 24));
  return { x: f32(f32(width - w) / 2), w };
}
/** The newest den or brood banner, top centre; returns the y below it. */
export function swarmBanner(app: GameHudApp, width: number, y: number): number {
  const c = app.context,
    banner = app.army.banners.filter((b) => b.until > c.time()).at(-1);
  if (!banner) return y;
  const t = app.theme,
    { x, w } = column(width),
    left = banner.until - c.time(),
    r = new Rect(x, y, w, 50);
  c.layer(
    r.inset(-2),
    () => {
      c.rect(r, t.surface, t.radius, t.success, 2);
      c.text(new Rect(f32(x + 12), f32(y + 5), f32(w - 24), 20), banner.title, t.success, 14, true, Align.Center);
      c.text(
        new Rect(f32(x + 12), f32(y + 26), f32(w - 24), 16),
        c.elideText(banner.detail, f32(w - 24), 11),
        t.text,
        11,
        false,
        Align.Center,
      );
    },
    Math.round(255 * clamp(left / 0.4, 0, 1)),
  );
  c.requestFrameAt(Math.min(banner.until, c.time() + 0.1));
  return f32(y + 56);
}
function waveTarget(town: Town, from: Point): Point {
  const raiders = town.monsters().filter((m) => m.raider && m.health > 0);
  if (!raiders.length) return from;
  return {
    x: raiders.reduce((s, m) => s + m.position.x, 0) / raiders.length,
    y: raiders.reduce((s, m) => s + m.position.y, 0) / raiders.length,
  };
}
/** A raid wave: a warning line for a few seconds and, while it lives, an arrow at the screen edge toward it. */
export function waveWarning(app: GameHudApp, width: number, height: number, y: number): number {
  const wave = app.army.wave,
    town = app.town;
  if (!wave) return y;
  const age = town.clock() - wave.at,
    live = town.raiding();
  if (age < 0 || (age > waveSeconds && !live) || age > 90) {
    app.army.wave = null;
    return y;
  }
  const c = app.context,
    t = app.theme,
    home = town.camp()?.center ?? town.map().camp();
  if (age <= waveSeconds) {
    const { x, w } = column(width),
      r = new Rect(x, y, w, 26);
    c.rect(r, t.surface, t.radius, t.danger, 2);
    c.text(
      r,
      c.elideText(`A raid wave of ${wave.size} comes from the ${wayTo(home, wave.from)}`, f32(w - 16), 12, true),
      t.danger,
      12,
      true,
      Align.Center,
    );
    y = f32(y + 32);
  }
  edgeArrow(app, waveTarget(town, wave.from), wave.size, width, height);
  c.requestFrameAt(c.time() + 0.25);
  return y;
}
/** An arrow on the screen edge pointing at a world point that is off screen; nothing while it is in view. */
function edgeArrow(app: GameHudApp, at: Point, size: number, width: number, height: number): void {
  const c = app.context,
    t = app.theme,
    screen = app.camera.toScreen(project(at.x, at.y), width, height),
    margin = 36,
    inside = screen.x >= margin && screen.y >= margin && screen.x <= width - margin && screen.y <= height - margin;
  if (inside) return;
  const cx = width / 2,
    cy = height / 2,
    dx = screen.x - cx,
    dy = screen.y - cy,
    scale = Math.min(Math.abs((cx - margin) / (dx || 1e-6)), Math.abs((cy - margin) / (dy || 1e-6))),
    x = f32(cx + dx * scale),
    y = f32(cy + dy * scale),
    l = Math.hypot(dx, dy) || 1,
    ux = dx / l,
    uy = dy / l,
    tip = { x: x + ux * 16, y: y + uy * 16 },
    back = (side: number) => ({ x: x + ux * 2 - uy * 9 * side, y: y + uy * 2 + ux * 9 * side });
  c.rect(new Rect(f32(x - 15), f32(y - 15), 30, 30), t.surface, 15, t.danger, 2);
  c.text(new Rect(f32(x - 15), f32(y - 15), 30, 30), String(size), t.danger, 11, true, Align.Center);
  for (const side of [1, -1]) {
    const b = back(side);
    c.line(f32(b.x), f32(b.y), f32(tip.x), f32(tip.y), t.danger, 3);
  }
  c.control('wave-arrow', new Rect(f32(x - 15), f32(y - 15), 30, 30), () => {
    const p = project(at.x, at.y);
    app.camera.x = p.x;
    app.camera.y = p.y;
    app.hoveredWorldTarget = null;
    app.renderer.invalidatePresentation();
  });
}
export enum Verdict {
  TooFew,
  Losing,
  Hard,
  Ready,
}
/** How a party of `count` at `average` level stands against a floor that wants `level`. */
export function partyVerdict(count: number, average: number, level: number): Verdict {
  return count < 3 || (count < 4 && average < level + 4)
    ? Verdict.TooFew
    : average < level - 1
      ? Verdict.Losing
      : average < level
        ? Verdict.Hard
        : Verdict.Ready;
}
const verdictWords = ['too few to stand against a swarm', 'likely to lose this floor', 'a hard fight', 'ready'];
export const floorLevel = (floor: number): number => recommendedLevel[Math.min(floor, recommendedLevel.length - 1)];
/** What the floor a party is sent to holds, in words the player can weigh, and whether the party is up to it.
 * Without `party` the selection is weighed, or every fighter when nobody is selected. */
export function floorForecast(app: GameAppState, gate: number, floor: number, party?: readonly Person[]): string[] {
  const town = app.town,
    site = town.map().dungeons()[gate];
  if (!site) return [];
  const fire = town.camp(),
    far = fire ? distance(lairOf(site), fire.center) : 0,
    monsters = Math.min(
      realmRules.mostMonsters,
      Math.round(realmRules.floorMonsters + realmRules.floorMonstersPerFloor * floor + realmRules.floorMonstersPerTile * far),
    ),
    word = monsters < 45 ? 'a large pack' : monsters < 65 ? 'a swarm' : monsters < 80 ? 'a great swarm' : 'a horde',
    level = floorLevel(floor),
    lines = [
      `Floor ${floor + 1} holds ${word} and dens that keep breeding more until destroyed.`,
      `Recommended: a small party at level ${level}, using their skills.`,
    ],
    selected = party
      ? []
      : controllableIds(town, app.chosen)
          .map((id) => town.person(id))
          .filter((p): p is Person => !!p),
    // The dialog is open with nobody selected; then every fighter of the settlement is the party to weigh.
    chosen = party
      ? party
      : selected.length
        ? selected
        : town.people().filter((p) => canControl(p) && p.downedAt < 0 && !!skillOfCalling(p.calling, 0));
  if (chosen.length) {
    const average = Math.round(chosen.reduce((s, p) => s + p.level, 0) / chosen.length),
      verdict = verdictWords[partyVerdict(chosen.length, average, level)];
    lines.push(
      party
        ? `Party: ${chosen.length} at level ${average} on average, ${verdict}.`
        : selected.length
          ? `Selected: ${chosen.length} at level ${average} on average, ${verdict}.`
          : `Your fighters: ${chosen.length} at level ${average} on average, ${verdict}.`,
    );
  }
  return lines;
}
