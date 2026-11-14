import { describe, expect, it } from 'vitest';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { harvestTiming, hammerTiming } from '../../packages/engine/src/work-timing';
import {
  layDown,
  PersonParts,
  personSprite,
  seatHead,
  stridePose,
} from '../../packages/native-renderer/src/world-sprites';
import {
  animateAction,
  animateBrood,
  animateGather,
  animateSip,
  animateTend,
  animateWork,
  strikePhase,
  workPose,
} from '../../packages/native-renderer/src/action-motion';
import {
  animateFieldWork,
  animateProcessingWork,
  animateTrade,
  tradeOf,
} from '../../packages/native-renderer/src/work-motion';
import { Structure } from '../../packages/engine/src/building-catalog';
import { handOf } from '../../packages/native-renderer/src/person-arm';
import type { Matrix } from '../../packages/native-renderer/src/paint';

const figure = (calling = Calling.Settler) => {
  const parts = new PersonParts();
  personSprite(new Person(3, 'Rowan', Role.Resident, calling, Race.Human, 4242, point()), parts);
  stridePose(parts, 0, false);
  return parts;
};
/** The head as drawn: its own seat carried by the body. */
function headInWorld(parts: PersonParts): Matrix {
  const b = parts.body!.matrix,
    h = parts.head[1].matrix;
  return [
    b[0] * h[0] + b[1] * h[3],
    b[0] * h[1] + b[1] * h[4],
    b[0] * h[2] + b[1] * h[5] + b[2],
    b[3] * h[0] + b[4] * h[3],
    b[3] * h[1] + b[4] * h[4],
    b[3] * h[2] + b[4] * h[5] + b[5],
    0,
    0,
    1,
  ];
}
/** True when a matrix only turns, scales evenly and moves: no shear, no squash. */
function rigid(m: Matrix): boolean {
  const across = Math.hypot(m[0], m[3]),
    up = Math.hypot(m[1], m[4]),
    skew = m[0] * m[1] + m[3] * m[4];
  return Math.abs(across - up) < 1e-4 && Math.abs(skew) < 1e-4;
}
const poses: [string, (parts: PersonParts, t: number) => void][] = [
  ['a sword cut', (p, t) => animateAction(p, 'sword', t, 1)],
  ['a punch', (p, t) => animateAction(p, null, t, 1)],
  ['a bow shot', (p, t) => animateAction(p, 'bow', t, 1)],
  ['a staff cast', (p, t) => animateAction(p, 'staff', t, 1)],
  [
    'felling',
    (p, t) => animateWork(p, 'axe', t * harvestTiming.period, harvestTiming.period, harvestTiming.impact),
  ],
  [
    'mining',
    (p, t) => animateWork(p, 'pickaxe', t * harvestTiming.period, harvestTiming.period, harvestTiming.impact),
  ],
  [
    'hammering',
    (p, t) => animateWork(p, 'hammer', t * hammerTiming.period, hammerTiming.period, hammerTiming.impact),
  ],
  [
    'bare-handed work',
    (p, t) => animateWork(p, null, t * harvestTiming.period, harvestTiming.period, harvestTiming.impact),
  ],
  ['hoeing', (p, t) => animateFieldWork(p, false, t * 1.25)],
  ['watering', (p, t) => animateFieldWork(p, true, t * 1.25)],
  ['sawing', (p, t) => animateProcessingWork(p, true, t)],
  ['chiselling', (p, t) => animateProcessingWork(p, false, t)],
  ['gathering', (p, t) => animateGather(p, Math.sin(Math.PI * t))],
  ['tending', (p, t) => animateTend(p, t)],
  ['eating', (p, t) => animateSip(p, t * 1.9, false)],
  ['brooding', (p, t) => animateBrood(p, t)],
  ['hauling at the well', (p, t) => animateTrade(p, 'haul', t * 2)],
  ['stacking stores', (p, t) => animateTrade(p, 'stack', t * 2.6)],
  ['keeping watch', (p, t) => animateTrade(p, 'watch', t * 9)],
  ['lying down', (p, t) => layDown(p, t)],
];

describe('the head on its neck', () => {
  it.each(poses)('stays one unsquashed shape through %s', (_, pose) => {
    const parts = figure();
    for (let i = 0; i <= 20; i++) {
      pose(parts, i / 20);
      seatHead(parts);
      const head = headInWorld(parts),
        b = parts.body!.matrix,
        neck = point(b[1] * parts.neck.y + b[2], b[4] * parts.neck.y + b[5]),
        // The head's own origin sits a fixed distance above wherever the body carries the neck.
        reach = Math.hypot(head[2] - neck.x, head[5] - neck.y);
      expect(rigid(head)).toBe(true);
      expect(Math.hypot(head[0], head[3])).toBeCloseTo(4.3, 4);
      expect(reach).toBeCloseTo(4, 3);
    }
  });
});

describe('blows', () => {
  it('draws back beside the head and lands on the strike with the body behind it', () => {
    const parts = figure(Calling.Warrior),
      lean = (t: number) => {
        animateAction(parts, 'sword', t, 1);
        return { forward: parts.body!.matrix[2], nod: parts.nod };
      };
    expect(lean(0.4).forward).toBeLessThan(0);
    expect(lean(0.4).nod).toBeLessThan(0);
    expect(lean(strikePhase).forward).toBeGreaterThan(1);
    expect(lean(strikePhase).nod).toBeGreaterThan(0.1);
  });
  it('keeps both feet where they stand while the body shifts over them', () => {
    const parts = figure(Calling.Warrior),
      planted = [0, 1].map(() => new Set<number>());
    for (let i = 0; i < 12; i++) {
      // Up to the strike only the body moves; the leading foot steps as the blow lands.
      animateAction(parts, 'sword', (i / 12) * 0.5, 1);
      parts.feet.forEach((foot, side) =>
        planted[side].add(Math.round((foot!.matrix[2] + parts.body!.matrix[2]) * 1000)),
      );
    }
    expect(planted[0].size).toBe(1);
    expect(planted[1].size).toBe(1);
  });
  it('holds the second hand to the shaft at the blow but never across the face in the wind-up', () => {
    const parts = figure(),
      hand = (t: number) => {
        animateWork(parts, 'axe', t * harvestTiming.period, harvestTiming.period, harvestTiming.impact);
        const arm = parts.arms[0],
          m = arm.forearm!.matrix;
        return m[3] * arm.wrist.x + m[4] * arm.wrist.y + m[5];
      };
    for (let i = 0; i <= 30; i++) expect(hand(i / 30)).toBeGreaterThan(parts.neck.y);
  });
  it.each(['axe', 'pickaxe', 'hammer'] as const)(
    'swings the %s furthest down exactly at the shared impact',
    (tool) => {
      for (const { period, impact } of [harvestTiming, hammerTiming]) {
        const contact = workPose(impact, period, impact, tool).direction;
        for (let i = 0; i < 60; i++)
          expect(workPose((i * period) / 60, period, impact, tool).direction).toBeLessThanOrEqual(
            contact + 1e-9,
          );
      }
    },
  );
});

describe('work at a building', () => {
  it('gives each kind of workplace its own motion and leaves tool work to the tool', () => {
    expect(tradeOf(Structure.Well)).toBe('haul');
    expect(tradeOf(Structure.Granary)).toBe('stack');
    expect(tradeOf(Structure.Apothecary)).toBe('counter');
    expect(tradeOf(Structure.MageTower)).toBe('channel');
    expect(tradeOf(Structure.Watchtower)).toBe('watch');
    for (const kind of [
      Structure.Sawmill,
      Structure.Weaponsmith,
      Structure.TrainingYard,
      Structure.Runestone,
    ])
      expect(tradeOf(kind)).toBeNull();
  });
  it("keeps a lookout's raised hand beside the head, never across the face", () => {
    const parts = figure();
    for (let i = 0; i <= 20; i++) {
      animateTrade(parts, 'watch', i * 0.45);
      const arm = parts.arms[1],
        m = arm.forearm!.matrix,
        hand = point(
          m[0] * arm.wrist.x + m[1] * arm.wrist.y + m[2],
          m[3] * arm.wrist.x + m[4] * arm.wrist.y + m[5],
        );
      expect(hand.y).toBeLessThan(parts.neck.y - 3);
      expect(hand.x).toBeGreaterThan(4.3);
    }
  });
});

describe('down and resting', () => {
  it('turns a fallen figure onto its back with the head carried round', () => {
    const parts = figure();
    layDown(parts, 1);
    seatHead(parts);
    const head = headInWorld(parts);
    // Feet stay at the origin; the head ends up behind them near the ground, turned with the body.
    expect(head[2]).toBeLessThan(-10);
    expect(head[5]).toBeGreaterThan(-6);
    expect(Math.atan2(head[3], head[0])).toBeCloseTo(-1.5, 2);
  });
  it('lifts the hand to the mouth to eat and tips the head back to drink', () => {
    const parts = figure();
    animateSip(parts, 0.8, false);
    expect(parts.nod).toBeGreaterThan(0);
    const raised = handOf(parts.arms[1]).y;
    expect(raised).toBeLessThan(parts.neck.y);
    animateSip(parts, 0.8, true);
    expect(parts.nod).toBeLessThan(0);
    animateSip(parts, 1.85, true);
    // The hand has come back down toward where it hangs.
    expect(handOf(parts.arms[1]).y).toBeGreaterThan(raised + 3);
  });
});
