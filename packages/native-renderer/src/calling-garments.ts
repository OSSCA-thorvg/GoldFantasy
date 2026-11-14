// The street figure's clothes, one wardrobe per calling; the portrait bust shares its colours.
import { Calling, type Person } from '../../engine/src/person';
import { callingOutfit, likenessOf } from '../../engine/src/character-cast';
import { BodyType } from '../../engine/src/person-appearance';
import { SceneNode, type Rgb } from './paint';
import { poly, oval, stroke, scale } from './sprite-primitives';
import { mix } from './vector-paint';
import { dusk } from './form-paint';

export interface Garment {
  /** Torso and skirt colour; differs from the cloth when armour covers it. */
  body: Rgb;
  sleeve: Rgb;
  /** Hem height above the ground: a robe sweeps low, a tunic shows the legs. */
  hem: number;
  hips: number;
  belt: Rgb | null;
  legs: Rgb | null;
}
const steel: Rgb = [132, 138, 146],
  steelLit: Rgb = [170, 176, 182],
  leather: Rgb = [112, 82, 56],
  hose: Rgb = [84, 74, 68];
const rgb = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];
const fur: Rgb = [214, 202, 178],
  wolf: Rgb = [156, 132, 110],
  bronze: Rgb = [186, 132, 74],
  gold: Rgb = [214, 178, 96];
/** A scalloped pelt laid along a line: the northern collar. */
function pelt(
  sprite: SceneNode,
  from: [number, number],
  to: [number, number],
  tufts: number,
  size: number,
  tone: Rgb = fur,
): void {
  for (let i = 0; i < tufts; i++) {
    const t = tufts === 1 ? 0.5 : i / (tufts - 1),
      x = from[0] + (to[0] - from[0]) * t,
      y = from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * size * 0.5;
    sprite.add(oval([x, y], size, size * 0.82, x > size ? dusk(tone, 0.26) : tone));
  }
}
/** A ring brooch pinning a cloak. */
function brooch(sprite: SceneNode, at: [number, number], size: number): void {
  sprite.add(oval(at, size, size, gold));
  sprite.add(oval(at, size * 0.45, size * 0.45, dusk(gold, 0.55)));
}
/** The wardrobe follows the calling a person holds now, never a colour saved with a look. */
export interface Wardrobe {
  calling: Calling;
  cloth: Rgb;
  trim: Rgb;
}
export function wardrobeOf(person: Person): Wardrobe {
  const outfit = callingOutfit(person.calling, person.look, likenessOf(person).wool);
  return { calling: person.calling, cloth: rgb(outfit.cloth), trim: rgb(outfit.trim) };
}
const robed = (calling: Calling) => calling === Calling.Mage || calling === Calling.Cleric;

export function garmentOf(body: BodyType, wardrobe: Wardrobe): Garment {
  const { calling, cloth, trim } = wardrobe,
    dress = calling === Calling.Settler && body === BodyType.Female;
  if (robed(calling))
    return {
      body: cloth,
      sleeve: cloth,
      hem: 1.3,
      hips: 1,
      belt: calling === Calling.Mage ? null : [150, 122, 84],
      legs: null,
    };
  if (calling === Calling.Warrior)
    return { body: steel, sleeve: steel, hem: 4, hips: 0.84, belt: [84, 60, 42], legs: hose };
  return {
    body: cloth,
    sleeve: calling === Calling.Bard ? mix(cloth, trim, 0.2) : cloth,
    hem: dress ? 1.3 : 4.4,
    hips: dress ? 1 : 0.84,
    belt: [84, 60, 42],
    legs: dress ? null : hose,
  };
}

/** Worn behind the torso: capes, a quiver, a lute. */
export function garmentBack(
  sprite: SceneNode,
  wardrobe: Wardrobe,
  height: number,
  width: number,
): { lute: SceneNode | null; cape: SceneNode | null } {
  let cloak: SceneNode | null = null;
  const { calling, cloth } = wardrobe,
    top = -height,
    shoulder = width * 0.55;
  if (calling === Calling.Traveller) {
    // Pack and bedroll ride high between the shoulders.
    sprite.add(
      poly(
        [
          [-6.6, top + 1.2],
          [-2, top + 0.6],
          [-2, -4.6],
          [-6.2, -4.2],
        ],
        leather,
      ),
    );
    sprite.add(
      poly(
        [
          [-6.6, top + 1.2],
          [-2, top + 0.6],
          [-2, top + 2.8],
          [-6.5, top + 3.2],
        ],
        scale(leather, 1.22),
      ),
    );
    sprite.add(stroke([-6.4, top - 0.1], [-2.2, top - 0.6], 1.9, [150, 136, 110]));
  }
  if (calling === Calling.Traveller || calling === Calling.Bard || calling === Calling.Mage) {
    const cape = scale(cloth, calling === Calling.Traveller ? 0.8 : 0.66),
      reach = calling === Calling.Bard ? 4.6 : calling === Calling.Mage ? 1.6 : 2.2;
    cloak = new SceneNode();
    sprite.add(cloak);
    cloak.add(
      poly(
        [
          [-shoulder - 0.7, top + 0.2],
          [shoulder + 0.7, top + 0.2],
          [width + 0.7, -reach],
          [-width - 0.7, -reach],
        ],
        cape,
      ),
    );
    cloak.add(
      poly(
        [
          [0, top + 0.2],
          [shoulder + 0.7, top + 0.2],
          [width + 0.7, -reach],
          [0, -reach],
        ],
        dusk(cape),
      ),
    );
  }
  if (calling === Calling.Ranger) {
    sprite.add(stroke([-3.6, top - 1.4], [-1.4, -5.8], 1.7, leather));
    for (const x of [-4.3, -3.5])
      sprite.add(stroke([x, top - 2.6], [x + 0.3, top - 1.2], 0.5, [214, 204, 180]));
  }
  if (calling !== Calling.Bard) return { lute: null, cape: cloak };
  // A skald's lyre: a rounded soundbox, two arms and a yoke.
  const lute = new SceneNode(),
    wood: Rgb = [170, 124, 76];
  lute.add(oval([-4.5, -6], 2.1, 2.3, wood));
  lute.add(oval([-3.9, -6], 1.2, 2.2, dusk(wood, 0.3)));
  for (const x of [-6, -3.1]) lute.add(stroke([x, -6.6], [x + 0.25, top - 0.4], 0.75, wood));
  lute.add(stroke([-6.2, top - 0.4], [-2.6, top - 0.7], 0.8, dusk(wood, 0.3)));
  for (const x of [-5.1, -4.5, -3.9])
    lute.add(stroke([x, -5.2], [x + 0.2, top - 0.5], 0.22, [232, 222, 198]));
  sprite.add(lute);
  return { lute, cape: cloak };
}

/** Details laid over the torso once the body, belt and collar are drawn. */
export function garmentFront(
  sprite: SceneNode,
  body: BodyType,
  wardrobe: Wardrobe,
  height: number,
  width: number,
  hem: number,
): void {
  const { calling, cloth, trim } = wardrobe,
    top = -height,
    shoulder = width * 0.55,
    waist = -height * 0.42,
    lit = (points: [number, number][], color: Rgb) => {
      sprite.add(poly(points, color));
      // Only the edge away from the light falls into dusk, as on the head.
      const edge = Math.max(...points.map(([x]) => x)) * 0.5,
        right = points.map(([x, y]) => [Math.max(edge, x), y] as [number, number]);
      sprite.add(poly(right, dusk(color)));
    };
  switch (calling) {
    case Calling.Settler:
      if (body === BodyType.Female) {
        lit(
          [
            [-1.5, waist],
            [1.5, waist],
            [2, hem + 0.7],
            [-2, hem + 0.7],
          ],
          trim,
        );
        // The apron dress is pinned at each shoulder by an oval brooch, beads strung between.
        for (const side of [-1, 1]) sprite.add(oval([side * 1.25, top + 2.2], 0.45, 0.55, bronze));
        for (const x of [-0.6, 0, 0.6])
          sprite.add(
            oval([x, top + 2.75 - Math.abs(x) * 0.4], 0.26, 0.26, x ? [92, 138, 168] : [222, 150, 70]),
          );
      }
      break;
    case Calling.Traveller:
      sprite.add(oval([0, top + 0.6], shoulder + 0.4, 1.1, dusk(trim, 0.12)));
      brooch(sprite, [-1.5, top + 1.5], 0.5);
      break;
    case Calling.Warrior:
      lit(
        [
          [-1.7, top + 0.6],
          [1.7, top + 0.6],
          [1.9, hem + 0.9],
          [-1.9, hem + 0.9],
        ],
        cloth,
      );
      sprite.add(stroke([-1.9, hem + 0.9], [1.9, hem + 0.9], 0.5, scale(cloth, 0.6)));
      for (const side of [-1, 1])
        sprite.add(
          oval([side * (shoulder + 0.2), top + 0.9], 1.5, 1.1, side < 0 ? steelLit : dusk(steel, 0.2)),
        );
      pelt(sprite, [-shoulder - 0.3, top + 0.4], [shoulder + 0.3, top + 0.4], 5, 0.95, wolf);
      break;
    case Calling.Ranger:
      lit(
        [
          [-shoulder - 0.9, top + 0.1],
          [shoulder + 0.9, top + 0.1],
          [shoulder + 1.2, top + 3.2],
          [0, top + 4.6],
          [-shoulder - 1.2, top + 3.2],
        ],
        scale(cloth, 0.8),
      );
      // The hood lies pushed back in a roll under the chin.
      sprite.add(oval([0, top + 0.5], shoulder + 0.5, 1.05, cloth));
      brooch(sprite, [0, top + 2.1], 0.6);
      break;
    case Calling.Mage:
      sprite.add(stroke([0, top + 1.6], [0, hem], 0.7, trim));
      sprite.add(
        poly(
          [
            [-width, hem],
            [width, hem],
            [width * 0.97, hem - 1],
            [-width * 0.97, hem - 1],
          ],
          trim,
        ),
      );
      for (const x of [-2.6, -1.3, 1.3, 2.6]) sprite.add(oval([x, hem - 0.5], 0.24, 0.24, dusk(cloth, 0.2)));
      // A seer's white fur collar over a string of glass and amber.
      pelt(sprite, [-shoulder + 0.2, top + 0.5], [shoulder - 0.2, top + 0.5], 4, 0.85);
      for (const x of [-1.1, -0.4, 0.4, 1.1])
        sprite.add(
          oval(
            [x, top + 2.2 - Math.abs(x) * 0.35],
            0.27,
            0.27,
            Math.abs(x) > 1 ? [92, 138, 168] : [222, 150, 70],
          ),
        );
      break;
    case Calling.Cleric:
      for (const x of [-1.9, 0.8])
        sprite.add(
          poly(
            [
              [x, top + 0.4],
              [x + 1.1, top + 0.4],
              [x + 1.1, hem - 2.4],
              [x, hem - 2.4],
            ],
            x < 0 ? trim : dusk(trim, 0.26),
          ),
        );
      sprite.add(stroke([-1.5, top + 0.5], [1.5, top + 0.5], 0.55, gold));
      break;
    case Calling.Bard:
      sprite.add(
        poly(
          [
            [-width * 0.84, hem],
            [width * 0.84, hem],
            [width * 0.82, hem - 0.9],
            [-width * 0.82, hem - 0.9],
          ],
          trim,
        ),
      );
      brooch(sprite, [1.7, top + 1], 0.55);
      break;
  }
}
