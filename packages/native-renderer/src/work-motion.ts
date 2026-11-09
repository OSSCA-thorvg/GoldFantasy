import { point, type Point } from '../../engine/src/geometry';
import { SceneNode, type Matrix } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import { poseArm } from './idle-gesture';
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

export function animateFieldWork(parts: PersonParts, watering: boolean, seconds: number): void {
  const phase = (seconds % 1.25) / 1.25,
    beat = Math.sin(phase * Math.PI * 2);
  if (watering) {
    const upper = -0.95,
      elbow = -0.25,
      tilt = 0.45 + Math.sin(seconds * 1.7) * 0.07;
    poseArm(parts.arms[1], upper, elbow, tilt - upper - elbow);
    poseArm(parts.arms[0], -0.5, -0.65, 0.15);
    parts.body?.transform([1, -0.07, 0.4, 0, 0.96, 0, 0, 0, 1]);
    const wrist = parts.arms[1].wrist,
      spout = handPoint(parts, point(wrist.x + 9, wrist.y - 1.5));
    parts.waterDrops?.opacity(255);
    parts.waterDrops?.children.forEach((drop, i) => {
      const t = (seconds * 1.6 + i / 7) % 1;
      drop.translate(spout.x + t * 3, spout.y + (1 - spout.y) * t * t);
      drop.opacity(Math.round(220 * Math.sin(t * Math.PI)));
    });
  } else {
    const upper = -1.05 - 0.55 * beat,
      elbow = -0.25,
      direction = 0.45 + 0.65 * Math.sin(phase * Math.PI * 2 - 0.6);
    poseArm(parts.arms[1], upper, elbow, direction - Math.atan2(-9, 6) - upper - elbow);
    poseArm(parts.arms[0], -0.5 - 0.15 * beat, -0.7, 0.1);
    parts.body?.transform([
      1,
      -0.08 - 0.03 * beat,
      0.5 + beat * 0.5,
      0,
      0.92 - 0.05 * Math.max(0, -beat),
      0,
      0,
      0,
      1,
    ]);
    parts.soilDust?.opacity(phase > 0.48 && phase < 0.83 ? 255 : 0);
    parts.soilDust?.children.forEach((dust, i) => {
      const t = Math.max(0, (phase - 0.48) / 0.35);
      dust.translate(12 + i * 1.2 - t * 3, 0.2 - Math.sin(t * Math.PI) * (1 + i * 0.4));
      dust.opacity(Math.round((1 - t) * 180));
    });
  }
  parts.feet[0]?.translate(-0.6, 0);
  parts.feet[1]?.translate(0.7, 0);
}

export function animateProcessingWork(parts: PersonParts, sawing: boolean, seconds: number): void {
  const beat = Math.sin(seconds * 6),
    upper = sawing ? -1.1 + beat * 0.18 : -1.15 - beat * 0.6,
    elbow = -0.2;
  const direction = sawing ? -0.12 : 0.45 - beat * 0.75;
  poseArm(parts.arms[1], upper, elbow, direction - (sawing ? -0.14 : Math.atan2(-7.8, 5.3)) - upper - elbow);
  poseArm(parts.arms[0], -1.3, 0, 1.3);
  parts.body?.transform([1, -0.08, 0.45 + beat * 0.3, 0, 0.95 - Math.max(0, beat) * 0.035, 0, 0, 0, 1]);
  parts.feet[0]?.translate(-0.5, 0);
  parts.feet[1]?.translate(0.6, 0);
  (sawing ? parts.sawLog : parts.workStone)?.opacity(255);
  if (!sawing) parts.chisel?.opacity(255);
}
