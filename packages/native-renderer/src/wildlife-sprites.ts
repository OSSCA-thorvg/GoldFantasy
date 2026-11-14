// Animals as rigged figures on the shared skeletons: they stand, graze or peck, walk and lie down to sleep.
import snore from './assets/wildlife/snore.json?raw';
import { f32 as f } from '../../engine/src/numeric';
import { point } from '../../engine/src/geometry';
import { AnimalKind } from '../../engine/src/person';
import { animalSpec } from '../../engine/src/wildlife';
import { birdClips, birdFigure } from './bird-rig';
import { AnimationNode, SceneNode, type Matrix, type PaintNode } from './paint';
import { quadrupedClips, quadrupedFigure } from './quadruped-rig';
import type { RigClip } from './rig-clip';
import type { RigFigure } from './rig-figure';
import { PoseBank } from './rig-pose-bank';
import { RigSkin } from './rig-skin';
import { ellipse } from './vector-paint';
import { dressAnimal } from './wildlife-skins';

/** A way of going shared by every animal on one skeleton. */
interface Gait {
  figure: RigFigure;
  bank: PoseBank;
  idle: RigClip;
  walk: RigClip;
  sleep: RigClip;
  /** Head down to the ground for a while: grazing, rooting, sniffing. A hen pecks within its idle. */
  graze?: RigClip;
}
let fourLegged: Gait | undefined, feathered: Gait | undefined;
function gaitOf(kind: AnimalKind): Gait {
  if (kind === AnimalKind.Chicken) {
    if (!feathered) {
      const figure = birdFigure();
      feathered = {
        figure,
        bank: new PoseBank(figure),
        idle: birdClips.idle,
        walk: birdClips.walk,
        sleep: birdClips.sleep,
      };
    }
    return feathered;
  }
  if (!fourLegged) {
    const figure = quadrupedFigure();
    fourLegged = {
      figure,
      bank: new PoseBank(figure),
      idle: quadrupedClips.idle,
      walk: quadrupedClips.walk,
      sleep: quadrupedClips.sleep,
      graze: quadrupedClips.graze,
    };
  }
  return fourLegged;
}
// How large each animal stands against its skeleton's mannequin, and where its sleeping head lies (in mannequin units).
const builds: Record<number, { scale: number; grazes: boolean; snore: readonly [number, number] }> = {
  [AnimalKind.Cow]: { scale: 0.98, grazes: true, snore: [9, -5.6] },
  [AnimalKind.Pig]: { scale: 0.86, grazes: true, snore: [8.6, -5] },
  [AnimalKind.Chicken]: { scale: 0.92, grazes: false, snore: [1.2, -5.4] },
  [AnimalKind.Wolf]: { scale: 1.18, grazes: false, snore: [9.6, -5.2] },
  [AnimalKind.Dog]: { scale: 0.84, grazes: true, snore: [9, -5.2] },
  [AnimalKind.Cat]: { scale: 0.56, grazes: false, snore: [8.4, -6] },
};
interface Animal {
  gait: Gait;
  grazes: boolean;
  scale: number;
  body: SceneNode;
  skin: RigSkin;
  snore: AnimationNode;
  head: readonly [number, number];
  shown: readonly Matrix[] | null;
}
const animals = new WeakMap<SceneNode, Animal>();
const snoreFrames = 90;
export function animalSprite(kind: AnimalKind): SceneNode {
  const spec = animalSpec(kind),
    build = builds[kind] ?? builds[AnimalKind.Wolf],
    gait = gaitOf(kind),
    scene = new SceneNode(),
    body = new SceneNode(),
    skin = new RigSkin(gait.figure.skeleton),
    zs = new AnimationNode(snore);
  dressAnimal(kind, skin);
  scene.add(ellipse(point(0, f(0.3)), f(spec.width * f(0.36)), f(spec.width * f(0.12)), [0, 0, 0, 85]));
  // The art is drawn at the mannequin's size; the body carries the animal's own.
  scene.add(body.add(skin.node).transform([build.scale, 0, 0, 0, build.scale, 0, 0, 0, 1]));
  scene.add(zs.opacity(0));
  const animal: Animal = {
    gait,
    grazes: build.grazes,
    scale: build.scale,
    body,
    skin,
    snore: zs,
    head: build.snore,
    shown: null,
  };
  animals.set(scene, animal);
  show(animal, gait.idle, 0, 1);
  return scene;
}
function show(animal: Animal, clip: RigClip, frame: number, hold: number): void {
  const matrices = animal.gait.bank.pose(clip, frame, hold);
  // Animals in step share their poses; one whose pose has not moved on is left alone.
  if (matrices === animal.shown) return;
  animal.shown = matrices;
  animal.skin.pose(matrices);
}
/** The art a click may land on. */
export function animalBody(sprite: SceneNode): PaintNode[] {
  const animal = animals.get(sprite);
  return animal ? [animal.body] : sprite.children.slice(1);
}
/** Poses one frame: lying asleep under rising Zs, walking, or standing with a spell of grazing now and then. */
export function poseAnimal(
  sprite: SceneNode,
  asleep: boolean,
  walking: boolean,
  clock: number,
  id: number,
  facing: number,
): void {
  const animal = animals.get(sprite);
  if (!animal) return;
  const { gait } = animal;
  // Each animal keeps its own offset so a herd never moves in step.
  if (asleep) show(animal, gait.sleep, clock * 30 + id * 17, 3);
  else if (walking) show(animal, gait.walk, clock * 34 + id * 7, 1);
  else {
    // Every so often a standing animal puts its head down for a few seconds.
    const every = 11 + (id % 5),
      since = (clock + id * 3.7) % every,
      spell = gait.graze && animal.grazes ? gait.graze.frames / 30 : 0;
    if (since < spell) show(animal, gait.graze!, since * 30, 2);
    else show(animal, gait.idle, clock * 30 + id * 37, 3);
  }
  if (animal.snore.alpha > 0 !== asleep) animal.snore.opacity(asleep ? 255 : 0);
  if (!asleep) return;
  // The 64-unit snore frame spans 9 world units and rises from its lower left corner; `facing` keeps
  // the letters readable when the sprite is mirrored.
  const size = 9 / 64,
    x = animal.head[0] * animal.scale,
    y = animal.head[1] * animal.scale;
  animal.snore.transform([f(facing * size), 0, f(x - facing * 1.5), 0, f(size), f(y - 9), 0, 0, 1]);
  animal.snore.frame((clock * 30 + id * 23) % snoreFrames);
}
