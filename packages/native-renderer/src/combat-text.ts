// Floating combat numbers and words: outlined, rising on a slight arc, merged per target. Numbers come only
// where they tell something in a crowd: crits, one total per skill use, blows on residents and on the few
// big monsters, never every swarmer's scratch.
import { distance, type Point } from '../../engine/src/geometry';
import { CombatCue, MonsterRank } from '../../engine/src/combat-events';
import type { Hit, Monster } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { hasHangul, koreanFont, localeRevision, translate } from '../../localization/src/index';
import { combatFace } from '../../native-ui/src/fonts';
import { TextNode, type Rgb } from './paint';
import {
  anchorOf,
  combatLayers,
  cuesOf,
  ease,
  isPrimary,
  onView,
  popScale,
  skillCastOf,
  swingsOf,
  tone,
  unit,
} from './combat-paint';
import { mix } from './vector-paint';
import { monsterHeight } from './monster-rank-look';
import type { WorldRendererState } from './world-renderer-state';

export enum TextKind {
  Dealt,
  Crit,
  Taken,
  Heal,
  Block,
  Level,
  Ability,
  Down,
  /** The whole damage of one skill use, once. */
  Skill,
}
interface Style {
  color: Rgb;
  size: number;
  life: number;
  pop: boolean;
}
// Sage and leaf are lifted toward peach so the words read on sunlit grass.
const sageText = mix(tone.sage, tone.peach, 0.35),
  leafText = mix(tone.leaf, tone.peach, 0.3);
export const textStyles: Record<TextKind, Style> = {
  [TextKind.Dealt]: { color: tone.peach, size: 9, life: 0.8, pop: false },
  [TextKind.Crit]: { color: tone.ochre, size: 13, life: 0.95, pop: true },
  [TextKind.Taken]: { color: tone.rust, size: 9, life: 0.8, pop: false },
  [TextKind.Heal]: { color: leafText, size: 9, life: 0.9, pop: false },
  [TextKind.Block]: { color: tone.sand, size: 7, life: 0.7, pop: false },
  [TextKind.Level]: { color: sageText, size: 10, life: 1.3, pop: true },
  [TextKind.Ability]: { color: sageText, size: 8, life: 1.1, pop: false },
  [TextKind.Down]: { color: tone.rust, size: 13, life: 1.4, pop: true },
  [TextKind.Skill]: { color: tone.peach, size: 12, life: 1.05, pop: true },
};
/** The Korean face for words in Hangul; Cinzel's capitals stand taller, so Hangul is set a little smaller. */
export const hangulFace = `${koreanFont}-Bold`;
const hangulScale = 0.9;
/** Blows on one target this close together read as one number. */
export const mergeWindow = 0.15;
const maxFloaters = 28;

export interface Floater {
  key: string;
  kind: TextKind;
  value: number;
  /** English source of a word, translated when drawn; '' for numbers. */
  words: string;
  text: string;
  at: number;
  /** Clock time of the last blow merged in. */
  last: number;
  anchor: Point;
  lift: number;
  /** How far newer words on the same target have pushed this one up, and how far it has moved so far. */
  push: number;
  pushed: number;
  side: number;
  front: TextNode;
  back: TextNode;
}
interface TextState {
  town: Town;
  nextHit: bigint;
  nextCue: bigint;
  floaters: Floater[];
  /** Clock time of the last pose, for easing the push. */
  posed: number;
  bounds: Map<string, { cx: number; cy: number }>;
  locale: number;
}
const states = new WeakMap<WorldRendererState, TextState>();

export function combatTextOf(s: WorldRendererState): readonly Floater[] {
  return states.get(s)?.floaters ?? [];
}
const labelOf = (kind: TextKind, value: number, words: string) =>
  kind === TextKind.Taken
    ? `-${value}`
    : kind === TextKind.Heal
      ? `+${value}`
      : kind === TextKind.Dealt || kind === TextKind.Crit || kind === TextKind.Skill
        ? `${value}`
        : translate(words);

function centre(s: WorldRendererState, state: TextState, text: string, size: number, font: string) {
  const id = `${font}|${size}|${text}`;
  let found = state.bounds.get(id);
  if (!found) {
    const b = s.measureText(text, size, font),
      fine = b && Number.isFinite(b.x + b.y + b.w + b.h) && b.w > 0;
    found = fine
      ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2 }
      : { cx: text.length * size * 0.3, cy: size * 0.5 };
    if (state.bounds.size > 256) state.bounds.clear();
    state.bounds.set(id, found);
  }
  return found;
}
const sizeOf = (item: Floater) => textStyles[item.kind].size * (hasHangul(item.text) ? hangulScale : 1);
function restyle(s: WorldRendererState, item: Floater): void {
  const style = textStyles[item.kind],
    font = hasHangul(item.text) ? hangulFace : combatFace(s.tvg),
    size = sizeOf(item);
  for (const node of [item.back, item.front]) {
    node.font = font;
    node.size = size;
    node.text = item.text;
    node.version++;
  }
  item.front.color = [...style.color, 255];
  item.back.color = [...tone.ink, 255];
  item.back.outline(Math.max(1.6, style.size * 0.2), ...tone.ink);
}
function spawn(
  s: WorldRendererState,
  state: TextState,
  key: string,
  kind: TextKind,
  value: number,
  words: string,
  at: number,
  anchor: Point,
  lift: number,
): Floater {
  // Older words on the same target make room above the new one instead of stacking under it.
  const now = state.town.clock(),
    room = textStyles[kind].size * 1.05;
  let stacked = 0;
  for (const f of state.floaters)
    if (f.key === key && now - f.at < textStyles[f.kind].life) {
      f.push += room;
      stacked++;
    }
  const item: Floater = {
    key,
    kind,
    value,
    words,
    text: labelOf(kind, value, words),
    at,
    last: at,
    anchor: { ...anchor },
    lift,
    push: 0,
    pushed: 0,
    side: (Number(state.nextHit + state.nextCue) + stacked) % 2 ? 1 : -1,
    front: new TextNode(),
    back: new TextNode(),
  };
  restyle(s, item);
  const layer = combatLayers(s).text;
  layer.add(item.back).add(item.front);
  state.floaters.push(item);
  if (state.floaters.length > maxFloaters) retire(s, state.floaters.shift()!);
  return item;
}
function retire(s: WorldRendererState, item: Floater): void {
  const layer = combatLayers(s).text;
  layer.remove(item.back);
  layer.remove(item.front);
}
/** The live monster a blow landed on, if any. */
function struck(monsters: readonly Monster[], at: Point): Monster | undefined {
  let best: Monster | undefined,
    gap = 0.7;
  for (const m of monsters) {
    const d = distance(m.position, at);
    if (d < gap) {
      gap = d;
      best = m;
    }
  }
  return best;
}
/** Numbers on these ranks only when they say something: a crit or a skill total. */
const crowd = (m: Monster | undefined) => m?.rank === MonsterRank.Swarmer || m?.rank === MonsterRank.Spitter;
function addHit(s: WorldRendererState, state: TextState, hit: Hit, monsters: readonly Monster[]): void {
  if (hit.onPerson && hit.person < 0) return; // Buildings have their own bars.
  if (!hit.blocked && hit.damage <= 0) return;
  const foe = hit.onPerson ? undefined : struck(monsters, hit.to);
  // A crit on a swarmer is told once, on the swing's target, not on every swarmer it swept.
  if (!hit.onPerson && !hit.blocked && !(hit.crit && isPrimary(hit)) && crowd(foe)) return;
  const key = hit.onPerson
      ? `p${hit.person}`
      : foe
        ? `m${foe.id}`
        : `x${Math.round(hit.to.x * 2)},${Math.round(hit.to.y * 2)}`,
    kind = hit.blocked
      ? TextKind.Block
      : hit.onPerson
        ? TextKind.Taken
        : hit.crit
          ? TextKind.Crit
          : TextKind.Dealt;
  if (kind !== TextKind.Block) {
    const family = (k: TextKind) => (k === TextKind.Crit ? TextKind.Dealt : k);
    const merge = state.floaters.find(
      (f) =>
        f.key === key && family(f.kind) === family(kind) && hit.at - f.last <= mergeWindow && hit.at >= f.at,
    );
    if (merge) {
      merge.value += hit.damage;
      merge.last = hit.at;
      if (kind === TextKind.Crit && merge.kind !== TextKind.Crit) {
        merge.kind = TextKind.Crit;
        merge.at = hit.at;
      }
      merge.text = labelOf(merge.kind, merge.value, '');
      restyle(s, merge);
      return;
    }
  }
  const lift = foe ? monsterHeight(state.town, foe, s) + 15 : hit.onPerson ? 38 : 20;
  spawn(s, state, key, kind, hit.damage, kind === TextKind.Block ? 'Block' : '', hit.at, hit.to, lift);
}
/** A skill's landing: one number for everything it hit, over the middle of what it hit. */
function addSkillTotal(s: WorldRendererState, state: TextState, swing: readonly Hit[], serial: bigint): void {
  const total = swing.reduce((sum, h) => sum + Math.max(0, h.damage), 0);
  if (total <= 0) return;
  const centre = {
      x: swing.reduce((sum, h) => sum + h.to.x, 0) / swing.length,
      y: swing.reduce((sum, h) => sum + h.to.y, 0) / swing.length,
    },
    item = spawn(s, state, `k${serial}`, TextKind.Skill, total, '', swing[0].at, centre, 30);
  item.side = 0;
}

/** Consumes new blows and combat cues and poses every live number. */
export function updateCombatText(s: WorldRendererState, town: Town): void {
  let state = states.get(s);
  if (!state || state.town !== town) {
    if (state) for (const item of state.floaters) retire(s, item);
    state = {
      town,
      nextHit: 0n,
      nextCue: 0n,
      floaters: [],
      posed: town.clock(),
      bounds: new Map(),
      locale: localeRevision(),
    };
    states.set(s, state);
  }
  if (state.locale !== localeRevision()) {
    state.locale = localeRevision();
    for (const item of state.floaters)
      if (item.words) {
        item.text = labelOf(item.kind, item.value, item.words);
        restyle(s, item);
      }
  }
  const now = town.clock(),
    monsters = town.monsters(),
    fresh: Hit[] = [];
  for (const hit of town.hits()) {
    if (hit.serial < state.nextHit) continue;
    state.nextHit = hit.serial + 1n;
    if (now - hit.at > 0.5 || !onView(s, hit.to)) continue;
    fresh.push(hit);
  }
  for (const swing of swingsOf(fresh)) {
    const cast = skillCastOf(town, swing);
    if (cast) addSkillTotal(s, state, swing, cast.serial);
    else for (const hit of swing.sort((a, b) => Number(isPrimary(b)) - Number(isPrimary(a)))) addHit(s, state, hit, monsters);
  }
  for (const event of cuesOf(town)) {
    if (event.serial < state.nextCue) continue;
    state.nextCue = event.serial + 1n;
    if (now - event.at > 1 || !onView(s, event.position)) continue;
    const key = event.person >= 0 ? `p${event.person}` : `x${event.position.x},${event.position.y}`;
    switch (event.cue) {
      case CombatCue.Heal:
        spawn(s, state, key, TextKind.Heal, Math.round(event.amount), '', event.at, event.position, 38);
        break;
      case CombatCue.Downed:
        spawn(s, state, key, TextKind.Down, 0, 'DOWN', event.at, event.position, 30);
        break;
      case CombatCue.LevelUp:
        spawn(
          s,
          state,
          key,
          TextKind.Level,
          event.amount,
          `Level ${event.amount}`,
          event.at,
          event.position,
          38,
        );
        break;
      case CombatCue.Ability:
        if (event.text) spawn(s, state, key, TextKind.Ability, 0, event.text, event.at, event.position, 38);
        break;
      case CombatCue.Crit:
      case CombatCue.Block: {
        // The blow itself normally carries the flag; this only covers a cue without one.
        const crit = event.cue === CombatCue.Crit,
          flagged = town
            .hits()
            .some(
              (h) =>
                (crit ? h.crit : h.blocked) &&
                Math.abs(h.at - event.at) < 0.05 &&
                Math.min(distance(h.to, event.position), distance(h.from, event.position)) < 0.8,
            );
        if (flagged) break;
        const near = state.floaters.find(
          (f) =>
            Math.abs(f.at - event.at) <= mergeWindow &&
            distance(f.anchor, event.position) < 0.8 &&
            (f.kind === TextKind.Dealt || f.kind === TextKind.Crit),
        );
        if (crit && near) {
          near.kind = TextKind.Crit;
          restyle(s, near);
        } else if (crit)
          spawn(s, state, key, TextKind.Crit, Math.round(event.amount), '', event.at, event.position, 30);
        else spawn(s, state, key, TextKind.Block, 0, 'Block', event.at, event.position, 38);
        break;
      }
    }
  }
  const byId = new Map(monsters.map((m) => [m.id, m])),
    step = unit((now - state.posed) * 16);
  state.posed = now;
  state.floaters = state.floaters.filter((item) => {
    const style = textStyles[item.kind],
      age = now - item.at,
      t = age / style.life;
    if (age < 0 || t >= 1) {
      retire(s, item);
      return false;
    }
    // Follow the target while it lives.
    const id = Number(item.key.slice(1)),
      follow =
        item.key[0] === 'p'
          ? town.person(id)?.position
          : item.key[0] === 'm'
            ? byId.get(id)?.position
            : undefined;
    if (follow) item.anchor = { ...follow };
    const foot = anchorOf(item.anchor),
      k = style.pop ? popScale(unit(age / 0.38)) : 0.85 + 0.15 * ease.out(unit(age / 0.07)),
      x = foot.x + item.side * (2 + 7 * ease.in(t)),
      y = foot.y - item.lift - (item.pushed += (item.push - item.pushed) * step) - 16 * ease.out(t),
      c = centre(s, state, item.text, item.front.size, item.front.font),
      alpha = Math.round(255 * (t < 0.6 ? 1 : 1 - ease.in((t - 0.6) / 0.4)));
    for (const node of [item.back, item.front]) {
      node.transform([k, 0, x - k * c.cx, 0, k, y - k * c.cy, 0, 0, 1]);
      node.opacity(alpha);
    }
    return true;
  });
}
