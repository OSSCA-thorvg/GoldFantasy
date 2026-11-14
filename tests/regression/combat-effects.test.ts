import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Calling, Monster, Role, type Hit, type Person } from '../../packages/engine/src/person';
import { CombatCue, MonsterRank, combatRules } from '../../packages/engine/src/combat-events';
import { point, type Point } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import { SceneNode, TextNode } from '../../packages/native-renderer/src/paint';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { tone, combatLayers } from '../../packages/native-renderer/src/combat-paint';
import {
  combatTextOf,
  TextKind,
  textStyles,
  mergeWindow,
} from '../../packages/native-renderer/src/combat-text';
import { combatEffectsOf, EffectKind, worldShake } from '../../packages/native-renderer/src/combat-effects';
import { barShapesOf, barTracksOf, chipHold } from '../../packages/native-renderer/src/unit-bars';
import { MarkKind, markProgress, telegraphsOf } from '../../packages/native-renderer/src/ground-telegraphs';
import { monsterHeight, rankScale } from '../../packages/native-renderer/src/monster-rank-look';
import { monsterKind } from '../../packages/native-renderer/src/monster-figures';
import { maxBars } from '../../packages/native-renderer/src/unit-bars';
import { FieldKind, skillFieldsOf } from '../../packages/native-renderer/src/skill-fields';
import { groundRadii } from '../../packages/native-renderer/src/combat-paint';
import { maxEffects } from '../../packages/native-renderer/src/combat-effects';
import { skillSpec, StrikeKind } from '../../packages/engine/src/skill-catalog';
import type { AbilityId } from '../../packages/engine/src/combat-events';
import { setLocale } from '../../packages/localization/src/index';
import { Tier } from '../../packages/native-renderer/src/combat-depth';
import { sortWorldObjects } from '../../packages/native-renderer/src/world-depth';
import { Camera, project } from '../../packages/engine/src/geometry';
import type { Effect } from '../../packages/native-renderer/src/combat-effects';
import { updateCombatPresentation } from '../../packages/native-renderer/src/combat-presentation';
import { monsterParts as rigOf } from '../../packages/native-renderer/src/world-sprites';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      putImageData: (p: Pixels) => {
        this.pixels = p.data.slice();
      },
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
  tvg.Font.load(
    'DejaVuSans-Bold',
    new Uint8Array(readFileSync('public/assets/native-fonts/DejaVuSans-Bold.ttf')),
  );
  tvg.Font.load('NotoSansKR-Bold', new Uint8Array(readFileSync('public/assets/native-fonts/NotoSansKR-Bold.ttf')));
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

function world() {
  const town = new Town(5, 32, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const s = new WorldRendererState(tvg);
  s.rows = Array.from({ length: town.map().width() + town.map().height() + 2 }, () => new SceneNode());
  s.currentVisibility.sample = () => 255;
  return { town, s };
}
function resident(town: Town, at: Point, calling = Calling.Warrior): Person {
  const p = town.makePerson(Role.Resident, calling, at);
  p.position = { ...at };
  town.folk.push(p);
  return p;
}
function monster(town: Town, at: Point, rank = MonsterRank.Grunt): Monster {
  const lair = town
      .map()
      .dungeons()
      .findIndex((d) => d.kind !== 4),
    m = new Monster(town.nextMonster++, lair, { ...at });
  m.rank = rank;
  m.health = m.vigor = 20;
  town.beasts.push(m);
  return m;
}
function blow(town: Town, from: Point, to: Point, damage: number, fields: Partial<Hit> = {}): Hit {
  const hit: Hit = {
    serial: town.nextBlow++,
    from: { ...from },
    to: { ...to },
    damage,
    onPerson: false,
    ranged: false,
    at: town.clock(),
    person: -1,
    ...fields,
  };
  town.blows.push(hit);
  return hit;
}
const advance = (town: Town, seconds: number) => {
  town.time += seconds;
};
const frame = (s: WorldRendererState, town: Town, selected: number[] = []) =>
  updateCombatPresentation(s, town, selected);

describe('combat text', () => {
  it('merges blows on one target within the window and keeps later blows apart', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    blow(town, hero.position, foe.position, 12, { person: hero.id, attacker: hero.id });
    frame(s, town);
    advance(town, mergeWindow * 0.6);
    blow(town, hero.position, foe.position, 8, { person: hero.id, attacker: hero.id });
    frame(s, town);
    expect(combatTextOf(s)).toHaveLength(1);
    expect(combatTextOf(s)[0]).toMatchObject({ value: 20, text: '20', kind: TextKind.Dealt });
    advance(town, mergeWindow + 0.05);
    blow(town, hero.position, foe.position, 5, { person: hero.id, attacker: hero.id });
    frame(s, town);
    const [first, second] = combatTextOf(s);
    expect(second).toMatchObject({ value: 5, kind: TextKind.Dealt });
    // The older number on the target is pushed up to make room instead of stacking.
    expect(first.push).toBeGreaterThan(textStyles[TextKind.Dealt].size);
    advance(town, 0.1);
    frame(s, town);
    expect(first.front.matrix[5]).toBeLessThan(
      second.front.matrix[5] - textStyles[TextKind.Dealt].size * 0.8,
    );
  });
  it('styles every kind from the palette with a dark outline behind the fill', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    blow(town, hero.position, foe.position, 30, { person: hero.id, attacker: hero.id, crit: true });
    blow(town, foe.position, hero.position, 7, { onPerson: true, person: hero.id });
    town.emit(CombatCue.Heal, hero.position, { person: hero.id, amount: 35 });
    town.emit(CombatCue.LevelUp, hero.position, { person: hero.id, amount: 5 });
    town.emit(CombatCue.Downed, point(12, 12), { person: 99 });
    town.emit(CombatCue.Ability, hero.position, { person: hero.id, text: 'Challenge' });
    frame(s, town);
    advance(town, 0.2);
    blow(town, foe.position, hero.position, 0, { onPerson: true, person: hero.id, blocked: true });
    frame(s, town);
    const byKind = new Map(combatTextOf(s).map((f) => [f.kind, f]));
    const expected: [TextKind, readonly number[], string][] = [
      [TextKind.Crit, tone.ochre, '30'],
      [TextKind.Taken, tone.rust, '-7'],
      [TextKind.Heal, textStyles[TextKind.Heal].color, '+35'],
      [TextKind.Level, textStyles[TextKind.Level].color, 'Level 5'],
      [TextKind.Down, tone.rust, 'DOWN'],
      [TextKind.Ability, textStyles[TextKind.Ability].color, 'Challenge'],
      [TextKind.Block, tone.sand, 'Block'],
    ];
    expect(textStyles[TextKind.Dealt].color).toEqual(tone.peach);
    // Healing stays green and the words stay sage, only lifted for reading on grass.
    const [r, g, b] = textStyles[TextKind.Heal].color;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    for (const [kind, color, text] of expected) {
      const item = byKind.get(kind)!;
      expect(item, TextKind[kind]).toBeDefined();
      expect(item.text).toBe(text);
      expect(item.front.color.slice(0, 3)).toEqual([...color]);
      expect(item.front.size).toBe(textStyles[kind].size);
      expect(item.back.stroke?.color).toEqual([...tone.ink]);
      expect(item.back.stroke!.width).toBeGreaterThan(1);
    }
    expect(textStyles[TextKind.Crit].size).toBeGreaterThan(textStyles[TextKind.Dealt].size * 1.3);
    expect(textStyles[TextKind.Block].size).toBeLessThan(textStyles[TextKind.Dealt].size);
    expect(textStyles[TextKind.Down].size).toBeGreaterThan(textStyles[TextKind.Dealt].size);
  });
  it('pops a critical number past full size, rises and fades, then removes its nodes', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    blow(town, hero.position, foe.position, 30, { person: hero.id, attacker: hero.id, crit: true });
    frame(s, town);
    const item = combatTextOf(s)[0],
      startY = item.front.matrix[5] + item.front.matrix[4] * 0;
    advance(town, 0.07);
    frame(s, town);
    expect(item.front.matrix[0]).toBeGreaterThan(1.05);
    advance(town, 0.5);
    frame(s, town);
    expect(item.front.matrix[0]).toBeCloseTo(1, 2);
    expect(item.front.matrix[5]).toBeLessThan(startY);
    advance(town, 0.3);
    frame(s, town);
    expect(item.front.alpha).toBeLessThan(255);
    advance(town, 0.3);
    frame(s, town);
    expect(combatTextOf(s)).toHaveLength(0);
    expect(combatLayers(s).text.children).toHaveLength(0);
  });
  it('ignores blows outside the visible area', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    s.currentVisibility.sample = () => 0;
    blow(town, hero.position, foe.position, 12, { person: hero.id });
    frame(s, town);
    expect(combatTextOf(s)).toHaveLength(0);
    expect(combatEffectsOf(s)).toHaveLength(0);
  });
});

describe('contact effects', () => {
  it('draws flat shards per kind of contact and leaves no nodes behind', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    blow(town, hero.position, foe.position, 12, { person: hero.id });
    blow(town, hero.position, point(10.6, 10.05), 24, { person: hero.id, crit: true });
    blow(town, point(14, 10), foe.position, 9, { ranged: true, person: hero.id });
    blow(town, foe.position, hero.position, 6, { onPerson: true, person: hero.id });
    blow(town, foe.position, hero.position, 0, { onPerson: true, person: hero.id, blocked: true });
    frame(s, town);
    const kinds = combatEffectsOf(s).map((e) => e.kind);
    expect(kinds).toEqual([
      EffectKind.Slash,
      EffectKind.Slash,
      EffectKind.Streak,
      EffectKind.Bite,
      EffectKind.Block,
    ]);
    const [plain, crit] = combatEffectsOf(s);
    expect(crit.pieces.length).toBeGreaterThan(plain.pieces.length);
    // Flat fills only: no strokes, no gradients.
    for (const effect of combatEffectsOf(s))
      for (const p of effect.pieces) {
        expect(p.node.strokeColor).toBeUndefined();
        expect(p.node.gradient).toBeUndefined();
        expect(p.node.color).toBeDefined();
      }
    advance(town, 0.05);
    frame(s, town);
    expect(plain.pieces[0].node.alpha).toBeGreaterThan(0);
    advance(town, 1.2);
    frame(s, town);
    expect(combatEffectsOf(s)).toHaveLength(0);
    expect(combatLayers(s).effects.children).toHaveLength(0);
  });
  it('plays every cue and caps live effects', () => {
    const { town, s } = world(),
      cleric = resident(town, point(10, 10), Calling.Cleric),
      bard = resident(town, point(11, 10), Calling.Bard),
      ranger = resident(town, point(12, 10), Calling.Ranger),
      foe = monster(town, point(13, 10), MonsterRank.Guardian);
    town.emit(CombatCue.Death, point(9, 9), { text: 'monsters' });
    town.emit(CombatCue.Downed, point(9, 10), { person: 77 });
    town.emit(CombatCue.Revived, cleric.position, { person: cleric.id });
    town.emit(CombatCue.Heal, cleric.position, { person: cleric.id, amount: 35 });
    town.emit(CombatCue.LevelUp, bard.position, { person: bard.id, amount: 3 });
    town.emit(CombatCue.Enrage, foe.position, { creature: foe.id });
    town.emit(CombatCue.Ability, bard.position, {
      person: bard.id,
      text: 'Rallying Verse',
      radius: 5,
      duration: 8,
    });
    town.emit(CombatCue.Ability, cleric.position, { person: cleric.id, text: 'Mend', radius: 6 });
    town.emit(CombatCue.Ability, ranger.position, { person: ranger.id, text: 'Aimed Shot' });
    frame(s, town);
    expect(combatEffectsOf(s).map((e) => e.kind)).toEqual([
      EffectKind.Wisp,
      EffectKind.Downed,
      EffectKind.Revived,
      EffectKind.Motes,
      EffectKind.LevelUp,
      EffectKind.Enrage,
      EffectKind.Verse,
      EffectKind.Cast,
      EffectKind.Aim,
    ]);
    // Only the Mage's burst marks the ground; Mend and the Verse have radii but no circle.
    expect(telegraphsOf(s).marks).toHaveLength(0);
    // The ranger's next shot is the long Aimed Shot streak.
    advance(town, 0.2);
    blow(town, ranger.position, foe.position, 60, { ranged: true, person: ranger.id, attacker: ranger.id });
    frame(s, town);
    const shot = combatEffectsOf(s).at(-1)!;
    expect(shot.kind).toBe(EffectKind.Streak);
    expect(shot.pieces[1].node.color!.slice(0, 3)).toEqual([...tone.teal]);
    // The wisp rises while the body fades (about 2.4 s), then breaks apart and is gone.
    const wisp = combatEffectsOf(s)[0];
    advance(town, 1.2);
    frame(s, town);
    expect(wisp.pieces[1].node.matrix[5]).toBeLessThan(-8);
    advance(town, 1.5);
    frame(s, town);
    expect(combatEffectsOf(s)).toHaveLength(0);
    for (let i = 0; i < 60; i++) blow(town, ranger.position, foe.position, 1, { person: ranger.id });
    frame(s, town);
    expect(combatEffectsOf(s).length).toBeLessThanOrEqual(40);
    expect(combatTextOf(s).length).toBeLessThanOrEqual(28);
  });
  it('breaks a slain monster apart instead of dropping it, then lets it go', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10), MonsterRank.Guardian);
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    const sprite = s.beasts.get(foe.id)!,
      row = s.rows[sprite.row];
    expect(row.children).toContain(sprite.paint);
    town.beasts.splice(town.beasts.indexOf(foe), 1);
    town.emit(CombatCue.Kill, foe.position, { creature: foe.id, person: hero.id });
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    expect(s.beasts.has(foe.id)).toBe(false);
    expect(row.children).toContain(sprite.paint);
    expect(combatEffectsOf(s).some((e) => e.kind === EffectKind.Kill)).toBe(true);
    // A guardian's fall shakes the world a little, unless motion is reduced.
    const shake = worldShake(s, town);
    expect(Math.hypot(shake.x, shake.y)).toBeGreaterThan(0);
    expect(Math.hypot(shake.x, shake.y)).toBeLessThanOrEqual(3);
    s.reducedMotion = true;
    expect(worldShake(s, town)).toEqual({ x: 0, y: 0 });
    advance(town, 0.2);
    frame(s, town);
    expect(sprite.paint.alpha).toBeLessThan(255);
    advance(town, 0.3);
    frame(s, town);
    expect(row.children).not.toContain(sprite.paint);
    advance(town, 1);
    frame(s, town);
    expect(combatEffectsOf(s)).toHaveLength(0);
  });
  it('drops a monster that simply left without any effect', () => {
    const { town, s } = world(),
      foe = monster(town, point(10.6, 10));
    moveAgents(s, town, new Traffic(), 0, []);
    const sprite = s.beasts.get(foe.id)!,
      row = s.rows[sprite.row];
    town.beasts.length = 0;
    moveAgents(s, town, new Traffic(), 0, []);
    expect(row.children).not.toContain(sprite.paint);
  });
});

describe('health bars', () => {
  it('shows a hurt monster with a chip that holds, then catches up', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    frame(s, town);
    expect(barShapesOf(s)!.foe.commands).toHaveLength(0);
    foe.health = 10;
    blow(town, hero.position, foe.position, 100, { person: hero.id });
    frame(s, town);
    const track = barTracksOf(s).get(`m${foe.id}`)!;
    expect(track.shown).toBeCloseTo(0.5);
    expect(track.chip).toBeCloseTo(1);
    expect(barShapesOf(s)!.foe.commands).toHaveLength(1);
    expect(barShapesOf(s)!.chip.commands).toHaveLength(1);
    advance(town, chipHold * 0.5);
    frame(s, town);
    expect(track.chip).toBeCloseTo(1);
    for (let i = 0; i < 20; i++) {
      advance(town, 0.1);
      frame(s, town);
    }
    expect(track.chip).toBeCloseTo(0.5, 3);
    expect(barShapesOf(s)!.chip.commands).toHaveLength(0);
    // A guardian's bar is wider than a grunt's.
    foe.rank = MonsterRank.Guardian;
    frame(s, town);
    const rect = barShapesOf(s)!.back.commands[0] as ['R', number, number, number, number, number, number];
    expect(rect[3]).toBeGreaterThan(30);
  });
  it('shows residents when hurt or selected and a draining ring when downed', () => {
    const { town, s } = world(),
      a = resident(town, point(10, 10)),
      b = resident(town, point(11, 10)),
      c = resident(town, point(12, 10));
    a.health = 1;
    b.health = 1;
    c.health = 1;
    frame(s, town);
    expect(barShapesOf(s)!.friend.commands).toHaveLength(0);
    frame(s, town, [a.id]);
    expect(barShapesOf(s)!.friend.commands).toHaveLength(1);
    b.health = 0.4;
    frame(s, town, [a.id]);
    expect(barShapesOf(s)!.friend.commands).toHaveLength(2);
    c.downedAt = town.clock();
    c.health = 0;
    frame(s, town);
    const ring = barShapesOf(s)!.ring.commands.length;
    expect(ring).toBeGreaterThan(20);
    expect(barShapesOf(s)!.ringBack.commands.length).toBeGreaterThan(0);
    advance(town, combatRules.bleedOut / 2);
    frame(s, town);
    expect(barShapesOf(s)!.ring.commands.length).toBeLessThan(ring);
    advance(town, combatRules.bleedOut / 2 - 5);
    frame(s, town);
    expect(barShapesOf(s)!.ring.commands).toHaveLength(0);
    expect(barShapesOf(s)!.ringUrgent.commands.length).toBeGreaterThan(0);
  });
});

describe('ground telegraphs', () => {
  it('fills a danger circle over its duration, then erupts on the slam', () => {
    const { town, s } = world(),
      foe = monster(town, point(10.6, 10), MonsterRank.Guardian);
    town.emit(CombatCue.Telegraph, foe.position, { creature: foe.id, radius: 2.4, duration: 1.6 });
    frame(s, town);
    const [mark] = telegraphsOf(s).marks;
    expect(mark.kind).toBe(MarkKind.Danger);
    expect(s.combatGround.children).toContain(mark.node);
    expect((mark.node.children[1] as { color: number[] }).color.slice(0, 3)).toEqual([...tone.rust]);
    advance(town, 0.8);
    frame(s, town);
    expect(markProgress(mark, town.clock())).toBeCloseTo(0.5);
    expect(mark.fill.matrix[0]).toBeGreaterThan(0.3);
    expect(mark.fill.matrix[0]).toBeLessThan(0.7);
    advance(town, 0.8);
    town.emit(CombatCue.Slam, foe.position, { creature: foe.id, radius: 2.4 });
    frame(s, town);
    expect(telegraphsOf(s).marks).toHaveLength(0);
    expect(telegraphsOf(s).bursts).toHaveLength(1);
    expect(s.combatGround.children).not.toContain(mark.node);
    expect(Math.hypot(worldShake(s, town).x, worldShake(s, town).y)).toBeGreaterThan(0);
    advance(town, 1.2);
    frame(s, town);
    expect(telegraphsOf(s).bursts).toHaveLength(0);
    expect(s.combatGround.children).toHaveLength(0);
  });
  it('marks the Rune Burst in teal and bursts when it lands', () => {
    const { town, s } = world(),
      mage = resident(town, point(10, 10), Calling.Mage);
    town.emit(CombatCue.Ability, point(13, 10), {
      person: mage.id,
      text: 'Rune Burst',
      radius: 2,
      duration: 0.8,
    });
    frame(s, town);
    const [mark] = telegraphsOf(s).marks;
    expect(mark.kind).toBe(MarkKind.Rune);
    expect((mark.node.children[1] as { color: number[] }).color.slice(0, 3)).toEqual([...tone.teal]);
    advance(town, 0.85);
    frame(s, town);
    expect(telegraphsOf(s).marks).toHaveLength(0);
    expect(telegraphsOf(s).bursts).toHaveLength(1);
  });
});

describe('monster rank', () => {
  it('scales by rank, crowns the guardian, recoils from blows and rears in a wind-up', () => {
    const { town, s } = world(),
      hero = resident(town, point(9.5, 10)),
      grunt = monster(town, point(10, 10)),
      brute = monster(town, point(12, 10), MonsterRank.Brute),
      stalker = monster(town, point(14, 10), MonsterRank.Stalker),
      guardian = monster(town, point(16, 10), MonsterRank.Guardian);
    moveAgents(s, town, new Traffic(), 0, []);
    const width = (m: Monster) => Math.abs(s.beasts.get(m.id)!.paint.matrix[0]);
    expect(width(grunt)).toBeCloseTo(1);
    expect(width(brute)).toBeCloseTo(rankScale(MonsterRank.Brute)[0]);
    expect(width(stalker)).toBeLessThan(1);
    expect(width(guardian)).toBeGreaterThan(1.4);
    const guardianPaint = s.beasts.get(guardian.id)!.paint,
      gruntPaint = s.beasts.get(grunt.id)!.paint;
    expect(guardianPaint.children.length).toBe(gruntPaint.children.length + 1);
    // Recoil: pushed away from the attacker for a moment.
    const before = gruntPaint.matrix[2];
    blow(town, hero.position, grunt.position, 10, { person: hero.id });
    advance(town, 0.04);
    moveAgents(s, town, new Traffic(), 0, []);
    expect(Math.abs(gruntPaint.matrix[2] - before)).toBeGreaterThan(1);
    advance(town, 0.3);
    moveAgents(s, town, new Traffic(), 0, []);
    expect(gruntPaint.matrix[2]).toBeCloseTo(before, 3);
    // Wind-up: the body leans back.
    guardian.windupUntil = town.clock() + 0.8;
    town.emit(CombatCue.Telegraph, guardian.position, { creature: guardian.id, radius: 2.4, duration: 1.6 });
    moveAgents(s, town, new Traffic(), 0, []);
    const body = rigOf(guardianPaint)!.body;
    expect(body.matrix[1]).toBeGreaterThan(0.1);
    expect(body.matrix[4]).toBeGreaterThan(1.05);
  });
  it('syncs the whole combat layer through ThorVG without errors', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10), MonsterRank.Guardian);
    blow(town, hero.position, foe.position, 12, { person: hero.id, crit: true });
    town.emit(CombatCue.Telegraph, foe.position, { creature: foe.id, radius: 2.4, duration: 1.6 });
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    expect(() => s.adapter.sync(s.root)).not.toThrow();
    expect(combatLayers(s).text.children.every((n) => n instanceof TextNode)).toBe(true);
    s.adapter.dispose();
  });
});

/** A blow carrying the strike fields the engine adds; read defensively by the renderer until then. */
function swingBlow(town: Town, from: Point, to: Point, damage: number, attacker: number, strike: StrikeKind, primary: boolean, fields: Partial<Hit> = {}) {
  const hit = blow(town, from, to, damage, { person: attacker, attacker, ...fields });
  Object.assign(hit, { strike, primary });
  return hit;
}
const kinds = (s: WorldRendererState) => combatEffectsOf(s).map((e) => e.kind);

describe('blows by weapon', () => {
  it('draws one effect per swing in the shape of its weapon', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      a = monster(town, point(10.7, 10)),
      b = monster(town, point(10.5, 10.6)),
      c = monster(town, point(10.2, 10.8));
    // A sword caught three; the hits share the attacker and the moment.
    swingBlow(town, hero.position, a.position, 10, hero.id, StrikeKind.Cleave, true);
    swingBlow(town, hero.position, b.position, 6, hero.id, StrikeKind.Cleave, false);
    swingBlow(town, hero.position, c.position, 6, hero.id, StrikeKind.Cleave, false);
    frame(s, town);
    expect(kinds(s)).toEqual([EffectKind.Cleave]);
    advance(town, 0.05);
    const mace = resident(town, point(9, 10)),
      bow = resident(town, point(7, 10), Calling.Ranger),
      staff = resident(town, point(8, 12), Calling.Mage),
      behind = monster(town, point(12, 10));
    swingBlow(town, mace.position, a.position, 12, mace.id, StrikeKind.Crush, true);
    swingBlow(town, bow.position, a.position, 8, bow.id, StrikeKind.Pierce, true, { ranged: true });
    swingBlow(town, bow.position, behind.position, 5, bow.id, StrikeKind.Pierce, false, { ranged: true });
    swingBlow(town, staff.position, b.position, 7, staff.id, StrikeKind.Splash, true, { ranged: true });
    swingBlow(town, staff.position, c.position, 3, staff.id, StrikeKind.Splash, false, { ranged: true });
    frame(s, town);
    expect(kinds(s)).toEqual([EffectKind.Cleave, EffectKind.Crush, EffectKind.Pierce, EffectKind.Splash]);
    // The pierce hangs from the farther enemy and its streak reaches back past the first.
    const shot = combatEffectsOf(s)[2];
    expect(shot.anchor).toEqual(behind.position);
    // Flat fills only, and every piece shows at its peak.
    advance(town, 0.08);
    frame(s, town);
    for (const effect of combatEffectsOf(s))
      for (const p of effect.pieces) {
        expect(p.node.strokeColor).toBeUndefined();
        expect(p.node.gradient).toBeUndefined();
      }
    expect(combatEffectsOf(s)[0].pieces.some((p) => p.node.alpha === 255)).toBe(true);
    advance(town, 1.5);
    frame(s, town);
    expect(combatEffectsOf(s)).toHaveLength(0);
  });
  it('reads a blow without strike fields as a single blow', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    blow(town, hero.position, foe.position, 9, { person: hero.id, attacker: hero.id });
    frame(s, town);
    expect(kinds(s)).toEqual([EffectKind.Slash]);
  });
});

describe('skills', () => {
  const cast = (town: Town, skill: AbilityId, at: Point, person: number) =>
    town.emit(CombatCue.Ability, at, {
      person,
      skill,
      text: skillSpec(skill).name,
      radius: skillSpec(skill).radius,
      duration: skillSpec(skill).duration || skillSpec(skill).delay,
    });
  it('plays all ten, each in its own shape, with lasting areas at their true radius', () => {
    const { town, s } = world(),
      warrior = resident(town, point(10, 10)),
      ranger = resident(town, point(11, 9), Calling.Ranger),
      mage = resident(town, point(9, 11), Calling.Mage),
      cleric = resident(town, point(8, 9), Calling.Cleric),
      bard = resident(town, point(9, 8), Calling.Bard),
      foes = [monster(town, point(11, 11)), monster(town, point(12, 10), MonsterRank.Swarmer)];
    monster(town, point(12.5, 11), MonsterRank.Den);
    cast(town, 'challenge', warrior.position, warrior.id);
    cast(town, 'whirl', warrior.position, warrior.id);
    cast(town, 'aimed', foes[0].position, ranger.id);
    cast(town, 'volley', point(13, 10), ranger.id);
    cast(town, 'burst', point(12, 12), mage.id);
    cast(town, 'frost', point(12, 9), mage.id);
    cast(town, 'mend', cleric.position, cleric.id);
    cast(town, 'sanctuary', cleric.position, cleric.id);
    cast(town, 'rally', bard.position, bard.id);
    cast(town, 'dirge', bard.position, bard.id);
    frame(s, town);
    expect(new Set(kinds(s))).toEqual(
      new Set([
        EffectKind.Challenge,
        EffectKind.Whirl,
        EffectKind.Aim,
        EffectKind.Volley,
        EffectKind.Cast,
        EffectKind.Frost,
        EffectKind.Sanctuary,
        EffectKind.Verse,
        EffectKind.Dirge,
      ]),
    );
    expect(telegraphsOf(s).marks.map((m) => m.kind)).toEqual([MarkKind.Rune]);
    const fields = () => skillFieldsOf(s);
    expect(fields().map((f) => f.kind)).toEqual([FieldKind.Volley, FieldKind.Frost, FieldKind.Sanctuary, FieldKind.Dirge]);
    // The dirge marks every foe in reach but not the den.
    expect(fields()[3].marks.map((m) => m.creature).sort()).toEqual(foes.map((f) => f.id).sort());
    // The volley's mark spans its true radius.
    const volley = fields()[0],
      { rx } = groundRadii(skillSpec('volley').radius),
      xs = (volley.node.children[2] as SceneNode).children.flatMap((n) =>
        (n as { commands: unknown[][] }).commands.filter((c) => c[0] === 'L').map((c) => Math.abs(c[1] as number)),
      );
    expect(Math.max(...xs)).toBeGreaterThan(rx * 0.95);
    expect(Math.max(...xs)).toBeLessThan(rx * 1.15);
    // The volley's mark gives way to falling arrows; frost and sanctuary stay for their durations.
    advance(town, skillSpec('volley').delay + 0.05);
    frame(s, town);
    expect(fields().map((f) => f.kind)).not.toContain(FieldKind.Volley);
    advance(town, 3);
    frame(s, town);
    expect(fields().map((f) => f.kind)).toEqual([FieldKind.Frost, FieldKind.Sanctuary, FieldKind.Dirge]);
    expect(s.combatGround.children.length).toBeGreaterThanOrEqual(2);
    advance(town, 6);
    frame(s, town);
    expect(fields()).toHaveLength(0);
    expect(combatEffectsOf(s)).toHaveLength(0);
    expect(combatLayers(s).effects.children).toHaveLength(0);
    expect(() => s.adapter.sync(s.root)).not.toThrow();
    s.adapter.dispose();
  });
  it('shows one total for a skill landing and no blow effect per enemy it hit', () => {
    const { town, s } = world(),
      mage = resident(town, point(9, 9), Calling.Mage),
      foes = [0, 1, 2].map((i) => monster(town, point(12 + i * 0.4, 12), MonsterRank.Swarmer));
    town.emit(CombatCue.Ability, point(12.4, 12), { person: mage.id, skill: 'burst', text: 'Rune Burst', radius: 2, duration: 0.8 });
    frame(s, town);
    advance(town, skillSpec('burst').delay);
    for (const foe of foes) blow(town, point(12.4, 12), foe.position, 25, { ranged: true, person: mage.id, attacker: mage.id });
    frame(s, town);
    const totals = combatTextOf(s).filter((f) => f.kind === TextKind.Skill);
    expect(totals).toHaveLength(1);
    expect(totals[0].value).toBe(75);
    expect(combatTextOf(s).filter((f) => f.kind === TextKind.Dealt)).toHaveLength(0);
    expect(kinds(s).filter((k) => k === EffectKind.Streak || k === EffectKind.Slash)).toHaveLength(0);
  });
});

describe('swarms', () => {
  it('gives a swarmer a small fall, puffs at a den, collapses a den and rolls the brood break out', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      swarmer = monster(town, point(10.6, 10), MonsterRank.Swarmer),
      den = monster(town, point(12, 12), MonsterRank.Den);
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    town.beasts.splice(town.beasts.indexOf(swarmer), 1);
    town.emit(CombatCue.Kill, swarmer.position, { creature: swarmer.id, person: hero.id });
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    // The rig animates the swarmer's body; the effect never borrows its sprite.
    expect(kinds(s)).toEqual([EffectKind.Fall]);
    expect(combatEffectsOf(s)[0].remains).toBeUndefined();
    town.emit(CombatCue.Spawn, den.position, { creature: 99, amount: den.id });
    town.emit(CombatCue.Wave, point(5, 5), { amount: 40 });
    frame(s, town);
    expect(kinds(s)).toEqual([EffectKind.Fall, EffectKind.Spawn]);
    town.emit(CombatCue.DenDestroyed, den.position, { creature: den.id, person: hero.id });
    frame(s, town);
    expect(Math.hypot(worldShake(s, town).x, worldShake(s, town).y)).toBeGreaterThan(0);
    town.emit(CombatCue.BroodBreak, den.position, { amount: 30 });
    frame(s, town);
    const collapse = combatEffectsOf(s).find((e) => e.kind === EffectKind.DenCollapse)!,
      fall = combatEffectsOf(s).find((e) => e.kind === EffectKind.Fall)!,
      brood = combatEffectsOf(s).find((e) => e.kind === EffectKind.BroodBreak)!;
    expect(collapse.pieces.length).toBeGreaterThan(fall.pieces.length * 3);
    expect(collapse.life).toBeGreaterThan(fall.life * 1.5);
    expect(brood.life).toBeGreaterThan(1);
    s.reducedMotion = true;
    expect(worldShake(s, town)).toEqual({ x: 0, y: 0 });
  });
  it('keeps a crowd of 150 cheap: capped bars and effects, numbers only where they tell', () => {
    const { town, s } = world(),
      party = [0, 1, 2, 3, 4].map((i) => resident(town, point(20 + i * 0.5, 20), i % 2 ? Calling.Ranger : Calling.Warrior)),
      horde: Monster[] = [];
    for (let i = 0; i < 150; i++)
      horde.push(
        monster(
          town,
          point(17 + (i % 15) * 0.5, 17 + Math.floor(i / 15) * 0.6),
          i === 0 ? MonsterRank.Den : i < 4 ? MonsterRank.Brute : MonsterRank.Swarmer,
        ),
      );
    let updateMs = 0,
      frames = 0,
      peakEffects = 0,
      peakText = 0;
    const fps = 60;
    for (let f = 0; f < fps * 2; f++) {
      advance(town, 1 / fps);
      // 60 swings a second, a third of them cleaves over three swarmers, some of them crits.
      const hero = party[f % party.length],
        foe = horde[1 + ((f * 7) % 149)];
      foe.health = Math.max(1, foe.health - 4);
      if (f % 3 === 0)
        for (let k = 0; k < 3; k++)
          swingBlow(town, hero.position, horde[1 + ((f * 7 + k) % 149)].position, 4, hero.id, StrikeKind.Cleave, k === 0);
      else blow(town, hero.position, foe.position, 4, { person: hero.id, attacker: hero.id, crit: f % 10 === 0 });
      if (f % 20 === 0) blow(town, foe.position, hero.position, 3, { onPerson: true, person: hero.id });
      const start = performance.now();
      frame(s, town);
      updateMs += performance.now() - start;
      frames++;
      peakEffects = Math.max(peakEffects, combatEffectsOf(s).length);
      peakText = Math.max(peakText, combatTextOf(s).length);
      town.blows = town.blows.filter((h) => town.clock() - h.at <= 2);
    }
    const perFrame = updateMs / frames;
    process.stderr.write(`combat layer, 150 monsters and 60 blows a second: ${perFrame.toFixed(3)} ms a frame (JS update)\n`);
    expect(perFrame).toBeLessThan(4);
    expect(peakEffects).toBeLessThanOrEqual(maxEffects);
    // Plain hits on swarmers write nothing; crits and blows on residents do.
    const swarmers = new Set(horde.filter((m) => m.rank === MonsterRank.Swarmer).map((m) => `m${m.id}`));
    expect(combatTextOf(s).filter((f) => f.kind === TextKind.Dealt && swarmers.has(f.key))).toHaveLength(0);
    expect(combatTextOf(s).some((f) => f.kind === TextKind.Crit || f.kind === TextKind.Taken)).toBe(true);
    expect(peakText).toBeLessThan(28);
    // Bars: the den always, hurt swarmers thin, never more than the cap, never an unhurt swarmer.
    const rects = barShapesOf(s)!.back.commands as ['R', number, number, number, number][];
    expect(rects.length).toBeLessThanOrEqual(maxBars);
    expect(rects.some((r) => r[3] > 28)).toBe(true);
    const fresh = horde.filter((m) => m.rank === MonsterRank.Swarmer && m.health === m.vigor);
    expect(fresh.length).toBeGreaterThan(0);
    for (const m of fresh) expect(barTracksOf(s).get(`m${m.id}`)?.shown ?? 1).toBe(1);
  });
});

describe('words in Korean', () => {
  it('translates floating words and draws Hangul in the Korean face, numbers stay in the combat face', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      foe = monster(town, point(10.6, 10));
    setLocale('KR');
    try {
      town.emit(CombatCue.LevelUp, hero.position, { person: hero.id, amount: 5 });
      blow(town, hero.position, foe.position, 12, { person: hero.id, attacker: hero.id });
      frame(s, town);
      const level = combatTextOf(s).find((f) => f.kind === TextKind.Level)!,
        dealt = combatTextOf(s).find((f) => f.kind === TextKind.Dealt)!;
      expect(level.text).toBe('레벨 5');
      expect(level.front.font).toBe('NotoSansKR-Bold');
      expect(level.front.size).toBeLessThan(textStyles[TextKind.Level].size);
      expect(dealt.text).toBe('12');
      expect(dealt.front.font).not.toBe('NotoSansKR-Bold');
      // Switching back redraws the live word in English.
      setLocale('ENG');
      frame(s, town);
      expect(level.text).toBe('Level 5');
      expect(level.front.font).not.toBe('NotoSansKR-Bold');
      expect(() => s.adapter.sync(s.root)).not.toThrow();
      s.adapter.dispose();
    } finally {
      setLocale('ENG');
    }
  });
});

describe('rank heights', () => {
  it('reads heights from the rig, shrinks only swarmers and leaves a den alone', () => {
    const { town, s } = world(),
      hero = resident(town, point(9.5, 10)),
      grunt = monster(town, point(10, 10)),
      swarmer = monster(town, point(12, 10), MonsterRank.Swarmer),
      den = monster(town, point(14, 10), MonsterRank.Den);
    const lair = town.map().dungeons()[grunt.lair].kind;
    expect(monsterHeight(town, grunt)).toBeCloseTo(monsterKind(lair).top);
    expect(rankScale(MonsterRank.Swarmer)).toEqual([0.7, 0.7]);
    expect(rankScale(MonsterRank.Den)).toEqual([1, 1]);
    moveAgents(s, town, new Traffic(), 0, []);
    const paint = (m: Monster) => s.beasts.get(m.id)!.paint;
    expect(Math.abs(paint(swarmer).matrix[4])).toBeCloseTo(0.7);
    expect(monsterHeight(town, swarmer, s)).toBeCloseTo(monsterHeight(town, grunt, s) * 0.7);
    // A den is never scaled, crowned or shoved by a blow.
    const before = paint(den).matrix[2],
      children = paint(den).children.length;
    blow(town, hero.position, den.position, 10, { person: hero.id });
    advance(town, 0.04);
    moveAgents(s, town, new Traffic(), 0, []);
    expect(paint(den).matrix[2]).toBeCloseTo(before, 4);
    expect(Math.abs(paint(den).matrix[4])).toBeCloseTo(1);
    expect(paint(den).children.length).toBe(children);
  });
  it('breaks up monsters that die with their brood without a Kill cue of their own', () => {
    const { town, s } = world(),
      brood = [0, 1, 2].map((i) => monster(town, point(10 + i, 10), MonsterRank.Swarmer));
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    town.beasts.length = 0;
    town.emit(CombatCue.BroodBreak, point(11, 10), { amount: 3 });
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    const falls = combatEffectsOf(s).filter((e) => e.kind === EffectKind.Fall);
    expect(falls).toHaveLength(3);
    expect(falls.every((e) => e.remains)).toBe(true);
    expect(falls.map((e) => Math.round(e.anchor.x))).toEqual(brood.map((m) => m.position.x));
  });
});

describe('draw order', () => {
  const tiersOf = (e: Effect) => new Set(e.parts.map((p) => p.tier));
  /** Where each part's node really is: flat ground, a world row, or the overhead layer. */
  function placedRight(s: WorldRendererState, e: Effect) {
    for (const part of e.parts) {
      if (part.tier === Tier.Ground) expect(s.combatGround.children).toContain(part.node);
      else if (part.tier === Tier.Overhead) expect(combatLayers(s).effects.children).toContain(part.node);
      else {
        expect(part.slot?.attached && s.rows.includes(part.slot.attached)).toBe(true);
        expect(part.slot!.attached!.children).toContain(part.node);
      }
    }
  }
  const look = (s: WorldRendererState, at: Point) => {
    const p = project(at.x, at.y);
    s.view = new Camera(p.x, p.y, 1);
    s.viewWidth = s.viewHeight = 3000;
  };
  const order = (s: WorldRendererState) => {
    sortWorldObjects(s);
    return s.objects.children;
  };
  it('puts every shape of every effect kind in its tier', () => {
    const { town, s } = world(),
      hero = resident(town, point(10, 10)),
      ranger = resident(town, point(9, 11), Calling.Ranger),
      foe = monster(town, point(10.6, 10)),
      far = monster(town, point(12, 10)),
      guardian = monster(town, point(14, 14), MonsterRank.Guardian),
      swarmer = monster(town, point(13, 9), MonsterRank.Swarmer);
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    blow(town, hero.position, foe.position, 5, { person: hero.id });
    blow(town, ranger.position, foe.position, 5, { person: ranger.id, ranged: true });
    blow(town, foe.position, hero.position, 5, { onPerson: true, person: hero.id });
    blow(town, foe.position, hero.position, 0, { onPerson: true, person: hero.id, blocked: true });
    const w = resident(town, point(8, 8)), m = resident(town, point(8, 9)), b = resident(town, point(8, 10)), r = resident(town, point(8, 11));
    swingBlow(town, w.position, foe.position, 5, w.id, StrikeKind.Cleave, true);
    swingBlow(town, w.position, far.position, 3, w.id, StrikeKind.Cleave, false);
    swingBlow(town, m.position, foe.position, 5, m.id, StrikeKind.Crush, true);
    swingBlow(town, b.position, foe.position, 5, b.id, StrikeKind.Pierce, true, { ranged: true });
    swingBlow(town, b.position, far.position, 3, b.id, StrikeKind.Pierce, false, { ranged: true });
    swingBlow(town, r.position, foe.position, 5, r.id, StrikeKind.Splash, true, { ranged: true });
    frame(s, town);
    const seen = new Map<EffectKind, Effect>();
    const check = (expected: Partial<Record<EffectKind, Tier[]>>) => {
      for (const e of combatEffectsOf(s)) seen.set(e.kind, e);
      for (const [kind, tiers] of Object.entries(expected)) {
        const e = seen.get(Number(kind));
        expect(e, EffectKind[Number(kind)]).toBeDefined();
        expect(tiersOf(e!), EffectKind[Number(kind)]).toEqual(new Set(tiers));
        placedRight(s, e!);
      }
    };
    check({
      [EffectKind.Slash]: [Tier.Body],
      [EffectKind.Streak]: [Tier.Body],
      [EffectKind.Bite]: [Tier.Body],
      [EffectKind.Block]: [Tier.Body],
      [EffectKind.Cleave]: [Tier.Body],
      [EffectKind.Crush]: [Tier.Body, Tier.Ground],
      [EffectKind.Pierce]: [Tier.Body],
      [EffectKind.Splash]: [Tier.Body, Tier.Ground],
    });
    advance(town, 1);
    frame(s, town);
    for (const [cue, at, fields] of [
      [CombatCue.Death, point(9, 9), { text: 'monsters' }],
      [CombatCue.Downed, point(9, 10), { person: 77 }],
      [CombatCue.Revived, hero.position, { person: hero.id }],
      [CombatCue.Heal, hero.position, { person: hero.id, amount: 30 }],
      [CombatCue.LevelUp, hero.position, { person: hero.id, amount: 3 }],
      [CombatCue.Enrage, guardian.position, { creature: guardian.id }],
      [CombatCue.Spawn, point(13, 13), { creature: 999, amount: 1 }],
      [CombatCue.DenDestroyed, point(15, 12), { creature: 998 }],
      [CombatCue.BroodBreak, point(15, 12), { amount: 3 }],
    ] as const)
      town.emit(cue, at, fields);
    const skillIds: AbilityId[] = ['challenge', 'whirl', 'aimed', 'volley', 'burst', 'frost', 'mend', 'sanctuary', 'rally', 'dirge'];
    for (const id of skillIds)
      town.emit(CombatCue.Ability, point(11, 12), { person: hero.id, skill: id, text: skillSpec(id).name, radius: skillSpec(id).radius, duration: skillSpec(id).duration || skillSpec(id).delay });
    town.beasts.splice(town.beasts.indexOf(swarmer), 1);
    town.emit(CombatCue.Kill, swarmer.position, { creature: swarmer.id, person: hero.id });
    frame(s, town);
    check({
      [EffectKind.Wisp]: [Tier.Standing],
      [EffectKind.Downed]: [Tier.Standing],
      [EffectKind.Revived]: [Tier.Body, Tier.Overhead],
      [EffectKind.Motes]: [Tier.Body],
      [EffectKind.LevelUp]: [Tier.Body, Tier.Overhead],
      [EffectKind.Enrage]: [Tier.Ground],
      [EffectKind.Spawn]: [Tier.Standing],
      [EffectKind.DenCollapse]: [Tier.Standing, Tier.Ground],
      [EffectKind.BroodBreak]: [Tier.Ground],
      [EffectKind.Challenge]: [Tier.Ground, Tier.Overhead],
      [EffectKind.Whirl]: [Tier.Body, Tier.Standing],
      [EffectKind.Aim]: [Tier.Overhead],
      [EffectKind.Volley]: [Tier.Standing],
      [EffectKind.Cast]: [Tier.Body],
      [EffectKind.Frost]: [Tier.Ground],
      [EffectKind.Sanctuary]: [Tier.Ground],
      [EffectKind.Verse]: [Tier.Body],
      [EffectKind.Dirge]: [Tier.Ground],
      [EffectKind.Fall]: [Tier.Standing],
    });
    // The whirl stands in four quarters round the warrior; each arrow of the volley where it lands.
    expect(seen.get(EffectKind.Whirl)!.parts.filter((p) => p.tier === Tier.Standing)).toHaveLength(4);
    expect(seen.get(EffectKind.Volley)!.parts.length).toBeGreaterThanOrEqual(9);
    // Skill areas: discs on the ground, crystals and petals standing, the dirge's marks overhead.
    for (const field of skillFieldsOf(s)) {
      expect(s.combatGround.children).toContain(field.node);
      for (const bit of field.standing) expect(bit.slot.attached!.children).toContain(bit.slot.node);
      for (const mark of field.marks) expect(combatLayers(s).effects.children).toContain(mark.node);
    }
    expect(skillFieldsOf(s).find((f) => f.kind === FieldKind.Frost)!.standing.length).toBeGreaterThan(4);
    expect(skillFieldsOf(s).find((f) => f.kind === FieldKind.Sanctuary)!.standing.length).toBeGreaterThan(3);
    // Telegraph circles lie on the ground; an eruption's rocks stand in sectors.
    town.emit(CombatCue.Slam, guardian.position, { creature: guardian.id, radius: 2.4 });
    frame(s, town);
    const [burst] = telegraphsOf(s).bursts;
    expect(burst.sectors.length).toBeGreaterThan(3);
    for (const sector of burst.sectors) expect(sector.slot.attached!.children).toContain(sector.slot.node);
    // Bars and words stay overhead.
    expect(s.combat.children).toContain(combatLayers(s).text);
    // The selection ring is drawn over the ground marks.
    const layers = s.world.children;
    expect(layers.indexOf(s.combatGround)).toBeLessThan(layers.indexOf(s.selection));
    expect(layers.indexOf(s.selection)).toBeLessThan(layers.indexOf(s.objects));
    expect(() => s.adapter.sync(s.root)).not.toThrow();
    s.adapter.dispose();
  });
  it('sorts a standing piece and a body blow between the units in front of and behind them', () => {
    const { town, s } = world(),
      behind = resident(town, point(10.4, 10.4)),
      front = resident(town, point(11.6, 11.6)),
      foe = monster(town, point(11, 11)),
      hero = resident(town, point(9.6, 11.6));
    look(s, foe.position);
    moveAgents(s, town, new Traffic(), 0, []);
    town.emit(CombatCue.Spawn, point(11.1, 11.1), { creature: 999, amount: 1 });
    blow(town, hero.position, foe.position, 5, { person: hero.id });
    frame(s, town);
    advance(town, 0.03);
    moveAgents(s, town, new Traffic(), 0, []);
    frame(s, town);
    const list = order(s),
      at = (node: unknown) => list.indexOf(node as never),
      fig = (id: number) => at(s.figures.get(id)!.paint),
      spawn = combatEffectsOf(s).find((e) => e.kind === EffectKind.Spawn)!.parts[0].node,
      slash = combatEffectsOf(s).find((e) => e.kind === EffectKind.Slash)!.parts[0].node,
      beast = at(s.beasts.get(foe.id)!.paint);
    for (const i of [fig(behind.id), fig(front.id), at(spawn), at(slash), beast]) expect(i).toBeGreaterThanOrEqual(0);
    expect(fig(behind.id)).toBeLessThan(at(spawn));
    expect(at(spawn)).toBeLessThan(fig(front.id));
    // The slash shows over its target, but a nearer resident still covers it.
    expect(beast).toBeLessThan(at(slash));
    expect(at(slash)).toBeLessThan(fig(front.id));
    // Fog hides them as it hides units: a part out of sight leaves the order.
    s.currentVisibility.sample = () => 0;
    frame(s, town);
    expect(order(s)).not.toContain(spawn);
  });
  it('moves its world nodes into the new rows when the rows are rebuilt', () => {
    const { town, s } = world();
    resident(town, point(10, 10));
    town.emit(CombatCue.Spawn, point(11, 11), { creature: 999, amount: 1 });
    frame(s, town);
    const part = combatEffectsOf(s)[0].parts[0],
      old = part.slot!.attached!;
    s.rows = Array.from({ length: town.map().width() + town.map().height() + 2 }, () => new SceneNode());
    advance(town, 0.02);
    frame(s, town);
    expect(old.children).not.toContain(part.node);
    expect(s.rows).toContain(part.slot!.attached);
    advance(town, 2);
    frame(s, town);
    expect(s.rows.every((row) => row.children.length === 0)).toBe(true);
  });
});
