// Authored native wildlife SVGs are retained byte-for-byte.
import cow from './assets/wildlife/cow.svg?raw';
import pig from './assets/wildlife/pig.svg?raw';
import chicken from './assets/wildlife/chicken.svg?raw';
import wolf from './assets/wildlife/wolf.svg?raw';
import dog from './assets/wildlife/dog.svg?raw';
import cat from './assets/wildlife/cat.svg?raw';
import { f32 as f } from '../../engine/src/numeric';
import { point } from '../../engine/src/geometry';
import { AnimalKind } from '../../engine/src/person';
import { animalSpec } from '../../engine/src/wildlife';
import { SceneNode, SvgPictureNode } from './paint';
import { ellipse } from './vector-paint';
export function animalSprite(kind: AnimalKind): SceneNode {
  const spec = animalSpec(kind),
    scene = new SceneNode();
  scene.add(ellipse(point(0, f(0.3)), f(spec.width * f(0.36)), f(spec.width * f(0.12)), [0, 0, 0, 85]));
  const picture = new SvgPictureNode([cow, pig, chicken, wolf, dog, cat][kind]);
  picture.size(spec.width, spec.height);
  picture.translate(f(-spec.width / 2), f(-spec.height * f(88 / 96)));
  return scene.add(picture);
}
