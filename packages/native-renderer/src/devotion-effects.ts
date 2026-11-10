import { project, type Point } from '../../engine/src/geometry';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode, type Matrix } from './paint';
import { reachArm } from './idle-gesture';
import type { PersonParts } from './world-sprites';
import type { WorldRendererState } from './world-renderer-state';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};

/** A quiet bow and joined hands, with the feet held on the altar's approach. */
export function animatePrayer(parts: PersonParts, elapsed: number, duration: number): void {
  const bow = smooth(elapsed / 0.65) * smooth((duration - elapsed) / 0.55),
    breath = Math.sin(elapsed * 2.1) * 0.008 * bow;
  const chest = (parts.arms[0].shoulder.y + parts.arms[1].shoulder.y) / 2 + 1.4;
  reachArm(parts.arms[0], { x: -0.35, y: chest }, -1, bow, 0, 0);
  reachArm(parts.arms[1], { x: 0.35, y: chest }, 1, bow, 0, 0);
  parts.body?.transform([1, -0.035 * bow, 0.3 * bow, 0, 1 - 0.13 * bow + breath, 0, 0, 0, 1]);
  parts.feet[0]?.translate(0, 0);
  parts.feet[1]?.translate(0, 0);
  parts.shadow?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

interface Arrival {
  person: number;
  at: number;
  position: Point;
  paint: SceneNode;
  beam: ShapeNode;
  sparks: ShapeNode[];
}
interface Effects {
  town: Town;
  next: bigint;
  arrivals: Arrival[];
}
const states = new WeakMap<WorldRendererState, Effects>();
function arrival(person: number, at: number, position: Point): Arrival {
  const paint = new SceneNode(),
    beam = new ShapeNode();
  beam.moveTo(-5, 0).lineTo(-2, -29).lineTo(2, -29).lineTo(5, 0).close();
  beam.gradient = {
    type: 'linear',
    coordinates: [0, -29, 0, 0],
    stops: [
      { offset: 0, color: [139, 215, 204, 0] },
      { offset: 0.65, color: [139, 215, 204, 100] },
      { offset: 1, color: [232, 225, 175, 165] },
    ],
  };
  paint.add(new ShapeNode().appendCircle(0, 0, 10, 4).fill(142, 208, 186, 85)).add(beam);
  const sparks = Array.from({ length: 6 }, (_, i) => {
    const rune = new ShapeNode()
      .moveTo(0, -2)
      .lineTo(0, 2)
      .moveTo(0, -1)
      .lineTo(i % 2 ? 1.5 : -1.5, 0.2)
      .strokeWidth(0.7)
      .strokeCap('round')
      .strokeFill(224, 226, 184);
    paint.add(rune);
    return rune;
  });
  return { person, at, position: { ...position }, paint, beam, sparks };
}

/** Consume real births only; re-rendering or loading a population never invents an arrival. */
export function updateDevotionEffects(s: WorldRendererState, town: Town): void {
  let state = states.get(s);
  if (!state || state.town !== town) {
    if (state) for (const item of state.arrivals) s.combat.remove(item.paint);
    state = { town, next: 0n, arrivals: [] };
    states.set(s, state);
  }
  const now = town.clock();
  for (const event of town.devotionEvents?.() ?? []) {
    if (event.serial < state.next) continue;
    state.next = event.serial + 1n;
    if (now - event.at < 1.5 && s.currentVisibility.sample(event.position) >= 119)
      state.arrivals.push(arrival(event.person, event.at, event.position));
  }
  state.arrivals = state.arrivals.filter((item) => {
    const age = now - item.at;
    if (age < 0 || age >= 1.5) {
      s.combat.remove(item.paint);
      return false;
    }
    if (!s.combat.children.includes(item.paint)) s.combat.add(item.paint);
    const at = project(item.position.x, item.position.y),
      progress = clamp(age / 1.5),
      fade = (1 - progress) * (1 - progress),
      visible = s.currentVisibility.sample(item.position) >= 119;
    item.paint.translate(at.x, at.y);
    item.paint.opacity(visible ? Math.round(255 * fade) : 0);
    item.beam.transform([1 + progress * 0.4, 0, 0, 0, 1 + progress * 0.2, -progress * 2, 0, 0, 1]);
    item.sparks.forEach((rune, i) => {
      const t = clamp((age - i * 0.035) / 1.3),
        angle = (i * Math.PI) / 3;
      rune.translate(Math.cos(angle) * (4 + t * 5), -4 - t * (14 + (i % 3) * 2));
      rune.opacity(Math.round(255 * Math.sin(t * Math.PI)));
    });
    const figure = s.figures.get(item.person);
    if (figure && age < 0.7 && visible) {
      const reveal = smooth(age / 0.7),
        base = figure.parts.body?.matrix;
      figure.paint.opacity(Math.round(figure.paint.alpha * reveal));
      s.selectionMarkers.get(item.person)?.opacity(figure.paint.alpha);
      if (base)
        figure.parts.body!.transform([
          base[0] * (0.95 + 0.05 * reveal),
          base[1],
          base[2],
          base[3],
          base[4],
          base[5] - (1 - reveal) * 3,
          0,
          0,
          1,
        ] as Matrix);
    }
    return true;
  });
}
