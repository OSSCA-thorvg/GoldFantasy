import { point, type Point } from '../../engine/src/geometry';
import { SceneNode, type Matrix } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import { poseArm, reachArm } from './person-arm';
import { animateGather, animateWork, poseFromClip, stand, swing, type ActionPose } from './action-motion';
import { Structure } from '../../engine/src/building-catalog';
import { hammerTiming } from '../../engine/src/work-timing';
import { humanoidClips } from './humanoid-rig';
import type { HeldTool } from './person-equipment';
import type { PersonParts } from './world-sprites';

export function createWorkProps(root: SceneNode, parts: PersonParts): void {
  const drops = new SceneNode(),
    dust = new SceneNode(),
    log = new SceneNode(),
    stone = new SceneNode();
  for (let i = 0; i < 7; i++) drops.add(oval([0, 0], 0.35, 0.65, [157, 204, 211, 220]));
  for (let i = 0; i < 4; i++) dust.add(oval([0, 0], 0.65, 0.4, [157, 128, 81, 145]));
  log.add(stroke([7, -3], [7, 0], 1.2, [74, 53, 34])).add(stroke([18, -3], [18, 0], 1.2, [74, 53, 34]));
  log.add(stroke([5, -4], [19, -4], 3.5, [112, 76, 43])).add(oval([19, -4], 1.4, 1.7, [179, 135, 78]));
  log.add(stroke([6, -5], [17, -5], 0.5, [168, 117, 65]));
  stone.add(
    poly(
      [
        [7, -2],
        [10, -5],
        [16, -4],
        [18, -1],
        [13, 1],
      ],
      [112, 113, 120],
    ),
  );
  stone.add(
    poly(
      [
        [7, -2],
        [10, -5],
        [13, -3],
        [13, 1],
      ],
      [157, 154, 150],
    ),
  );
  stone.add(stroke([10, -5], [16, -4], 0.5, [191, 185, 170]));
  parts.waterDrops = drops;
  parts.soilDust = dust;
  parts.sawLog = log;
  parts.workStone = stone;
  for (const paint of [drops, dust, log, stone]) {
    paint.opacity(0);
    root.add(paint);
  }
}
export function clearWorkProps(parts: PersonParts): void {
  for (const paint of [parts.waterDrops, parts.soilDust, parts.sawLog, parts.workStone, parts.chisel])
    paint?.opacity(0);
}
const transform = (m: Matrix, p: Point): Point =>
  point(m[0] * p.x + m[1] * p.y + m[2], m[3] * p.x + m[4] * p.y + m[5]);
const handPoint = (parts: PersonParts, p: Point): Point =>
  transform(
    parts.body!.matrix,
    transform(parts.arms[1].forearm!.matrix, transform(parts.arms[1].hand!.matrix, p)),
  );

// Breaking soil: the hoe lifted beside the head, driven into the row, then drawn back through it.
const till: readonly TillKey[] = [
  [0, -1.0, -0.7, -0.6, 0, 0, 0.01, 0],
  [0.36, -1.45, -1.5, -1.9, -0.04, -0.25, 0.015, -0.05],
  [0.5, -0.62, -0.12, 0.42, 0.085, 0.42, 0.07, 0.16],
  [0.8, -0.72, -0.6, 0.5, 0.05, 0.05, 0.05, 0.12],
  [1, -1.0, -0.7, -0.6, 0, 0, 0.01, 0],
];
type TillKey = readonly [number, number, number, number, number, number, number, number];
const ease = (t: number) => t * t * (3 - 2 * t);
function tillPose(phase: number): ActionPose {
  let next = 1;
  while (next < till.length - 1 && phase > till[next][0]) ++next;
  const from = till[next - 1],
    to = till[next],
    t = (phase - from[0]) / (to[0] - from[0]),
    // The blade drops fast into the earth and is hauled back slowly.
    eased = next === 2 ? t * t * t : ease(t),
    mix = (i: number) => from[i] + (to[i] - from[i]) * eased;
  return {
    upper: mix(1),
    elbow: mix(2),
    direction: mix(3),
    lean: mix(4),
    forward: mix(5),
    crouch: mix(6),
    nod: mix(7),
    lift: 0,
  };
}
export function animateFieldWork(
  parts: PersonParts,
  watering: boolean,
  seconds: number,
  tool: HeldTool = 'hoe',
): void {
  const phase = (seconds % 1.25) / 1.25;
  if (watering) {
    // The can is carried along the row at a steady tilt, the gardener watching it fall.
    const sway = Math.sin(seconds * 1.5),
      upper = -0.95 + 0.06 * sway,
      elbow = -0.25,
      tilt = 0.45 + Math.sin(seconds * 1.7) * 0.07;
    poseArm(parts.arms[1], upper, elbow, tilt - upper - elbow);
    poseArm(parts.arms[0], -0.3, -0.5, 0.1);
    stand(
      parts,
      {
        upper,
        elbow,
        direction: tilt,
        lean: 0.06,
        forward: 0.35 + 0.3 * sway,
        crouch: 0.03,
        nod: 0.13,
        lift: 0,
      },
      0.55,
    );
    const wrist = parts.arms[1].wrist,
      spout = handPoint(parts, point(wrist.x + 9, wrist.y - 1.5));
    parts.waterDrops?.opacity(255);
    parts.waterDrops?.children.forEach((drop, i) => {
      const t = (seconds * 1.6 + i / 7) % 1;
      drop.translate(spout.x + t * 3, spout.y + (1 - spout.y) * t * t);
      drop.opacity(Math.round(220 * Math.sin(t * Math.PI)));
    });
    return;
  }
  const pose = tillPose(phase);
  swing(parts, tool, pose, null);
  stand(parts, pose, 0.55);
  parts.soilDust?.opacity(phase > 0.48 && phase < 0.83 ? 255 : 0);
  parts.soilDust?.children.forEach((dust, i) => {
    const t = Math.max(0, (phase - 0.48) / 0.35);
    dust.translate(12 + i * 1.2 - t * 3, 0.2 - Math.sin(t * Math.PI) * (1 + i * 0.4));
    dust.opacity(Math.round((1 - t) * 180));
  });
}

export function animateProcessingWork(parts: PersonParts, sawing: boolean, seconds: number): void {
  const beat = Math.sin(seconds * 6),
    shoulder = parts.arms[1].shoulder.y;
  if (sawing) {
    // Long strokes from the shoulder, the body rocking with them, the other hand on the log.
    const upper = -1.1 + beat * 0.26,
      elbow = -0.35 - beat * 0.28;
    poseArm(parts.arms[1], upper, elbow, -0.12 + 0.14 - upper - elbow);
    reachArm(parts.arms[0], point(6.2, shoulder + 4.2), 1, 0, 0);
    stand(
      parts,
      {
        upper,
        elbow,
        direction: -0.12,
        lean: 0.07 + beat * 0.025,
        forward: 0.45 + beat * 0.4,
        crouch: 0.04,
        nod: 0.12,
        lift: 0,
      },
      0.55,
    );
    parts.sawLog?.opacity(255);
    return;
  }
  // The mallet rises slowly and comes down sharply on a chisel held dead still.
  const raise = ease(0.5 - 0.5 * beat) ** 0.7,
    upper = -1.1 - 0.5 * raise,
    elbow = -0.2 - 0.3 * raise,
    direction = 0.42 - 0.95 * raise;
  poseArm(parts.arms[1], upper, elbow, direction - Math.atan2(-7.8, 5.3) - upper - elbow);
  poseArm(parts.arms[0], -1.3, 0, 1.3);
  stand(
    parts,
    {
      upper,
      elbow,
      direction,
      lean: 0.07,
      forward: 0.4 + (1 - raise) * 0.2,
      crouch: 0.045 + (1 - raise) * 0.015,
      nod: 0.1 + (1 - raise) * 0.05,
      lift: 0,
    },
    0.5,
  );
  parts.workStone?.opacity(255);
  parts.chisel?.opacity(255);
}

/**
 * Making an item at a craft station. With `pounding` the crafter's own hammer beats the piece into
 * shape; otherwise a blade, or the bare hand, is drawn along it. `lift` (0..1) takes the finished
 * piece up from the bench and holds it to the light.
 */
export function animateCraft(
  parts: PersonParts,
  tool: HeldTool | null,
  pounding: boolean,
  seconds: number,
  lift: number,
): void {
  if (lift > 0) poseFromClip(parts, humanoidClips.admire, lift * humanoidClips.admire.frames, tool);
  else if (pounding) animateWork(parts, tool, seconds, hammerTiming.period, hammerTiming.impact);
  else poseFromClip(parts, humanoidClips.whittle, seconds * 30, tool);
}

/** What a worker's hands do while standing at a workplace that has no tool of its own. */
export type Trade = 'haul' | 'stack' | 'counter' | 'channel' | 'watch';
export function tradeOf(kind: Structure): Trade | null {
  switch (kind) {
    case Structure.Well:
      return 'haul';
    case Structure.Camp:
    case Structure.Storehouse:
    case Structure.Granary:
    case Structure.WoodStore:
    case Structure.StoneStore:
    case Structure.Lumberyard:
    case Structure.Quarry:
      return 'stack';
    case Structure.Apothecary:
    case Structure.Tavern:
    case Structure.Hostel:
    case Structure.Inn:
    case Structure.GrandInn:
    case Structure.MarketStalls:
    case Structure.MarketHall:
    case Structure.Bazaar:
      return 'counter';
    case Structure.MageTower:
    case Structure.Portal:
      return 'channel';
    case Structure.Watchtower:
      return 'watch';
    default:
      return null;
  }
}
const still: ActionPose = {
  upper: 0,
  elbow: 0,
  direction: 0,
  crouch: 0,
  lift: 0,
  lean: 0,
  forward: 0,
  nod: 0,
};
export function animateTrade(parts: PersonParts, trade: Trade, seconds: number): void {
  const [left, right] = parts.arms,
    shoulder = right.shoulder.y;
  if (trade === 'haul') {
    // Hand over hand on the well rope, the body sinking a little into each pull.
    const turn = seconds * 4.4,
      pull = Math.sin(turn);
    reachArm(right, point(4.1, shoulder + 3 + 2.4 * pull), 1, 0, 0);
    if (left.free) reachArm(left, point(3.7, shoulder + 3 - 2.4 * pull), 1, 0, 0);
    stand(
      parts,
      { ...still, crouch: 0.025 + 0.02 * Math.abs(pull), lean: -0.03, forward: -0.2, nod: 0.06 },
      0.5,
    );
  } else if (trade === 'stack') {
    // Stoop for a load, straighten, set it on the pile, and again.
    const cycle = (seconds % 2.6) / 2.6;
    if (cycle < 0.5) animateGather(parts, Math.sin(Math.PI * (cycle / 0.5)));
    else {
      const set = Math.sin(Math.PI * ((cycle - 0.5) / 0.5));
      reachArm(right, point(5.4, shoulder + 2.4), set, 0, 0);
      if (left.free) reachArm(left, point(4.2, shoulder + 2.8), set, 0, 0);
      stand(
        parts,
        { ...still, crouch: 0.01 * set, lean: 0.05 * set, forward: 0.35 * set, nod: 0.05 * set },
        0.3,
      );
    }
  } else if (trade === 'counter') {
    // One hand steadies a bowl or a cup at the chest while the other works in it.
    const turn = seconds * 5;
    reachArm(right, point(2.5 + 0.45 * Math.cos(turn), shoulder + 2.7 + 0.3 * Math.sin(turn)), 1, 0, 0);
    if (left.free) reachArm(left, point(1.5, shoulder + 3.5), 1, 0, 0);
    stand(parts, { ...still, crouch: 0.01, lean: 0.02, nod: 0.13 + 0.015 * Math.sin(turn * 0.5) }, 0.2);
  } else if (trade === 'watch') {
    // A lookout shades the eyes and sweeps the horizon, slowly.
    const sweep = Math.sin(seconds * 0.7);
    // The hand goes to the temple, clear of the face, as if against the light.
    reachArm(right, point(5, parts.neck.y - 4.6 - 0.25 * sweep), 1, 0, 0);
    if (left.free) poseArm(left);
    stand(
      parts,
      { ...still, lean: -0.02 + 0.02 * sweep, forward: 0.25 * sweep, nod: -0.05 + 0.04 * sweep },
      0.3,
    );
  } else {
    // Hands lifted toward the working, rising and falling as it answers.
    const swell = Math.sin(seconds * 1.7);
    reachArm(right, point(4.6, shoulder - 1 - 0.8 * swell), 1, 0, 0);
    if (left.free) reachArm(left, point(2.6, shoulder - 0.2 + 0.8 * swell), 1, 0, 0);
    stand(parts, { ...still, lean: -0.025, forward: -0.15, nod: -0.07 - 0.02 * swell }, 0.35);
  }
}
