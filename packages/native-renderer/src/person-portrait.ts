import { Person, Activity } from '../../engine/src/person';
import { appearanceOf, Mood } from '../../engine/src/person-look';
export { Mood } from '../../engine/src/person-look';
import { f32 } from '../../engine/src/numeric';
import { SceneNode, ShapeNode } from './paint';
import { characterHead, characterPortraitPlacement } from './character-assets';
import { portraitBackground, type PortraitBackdrop } from './portrait-background';
export function moodOf(p: Person): Mood {
  if (p.activity === Activity.Sleeping && !p.moving() && !p.crossingDoorway()) return Mood.Asleep;
  if (p.activity === Activity.Fighting) return Mood.Fierce;
  if (p.health < f32(0.35)) return Mood.Hurt;
  if (p.rest < f32(0.12)) return Mood.Exhausted;
  if (p.food < f32(0.2)) return Mood.Hungry;
  if (p.stress > f32(0.65)) return Mood.Stressed;
  if (p.rest < f32(0.3)) return Mood.Tired;
  const easy = p.stress < f32(0.2) && p.food > f32(0.5) && p.rest > f32(0.5);
  if (easy || p.activity === Activity.Relaxing || p.activity === Activity.Praying) return Mood.Cheerful;
  return Mood.Content;
}
export function moodName(mood: Mood): string {
  return (
    ['Content', 'Cheerful', 'Tired', 'Exhausted', 'Hungry', 'Stressed', 'Hurt', 'Asleep', 'Fierce'][mood] ??
    ''
  );
}
export function personPortrait(
  person: Person,
  _mood: Mood,
  width: number,
  height: number,
  backdrop: PortraitBackdrop,
): SceneNode {
  const frame = new SceneNode().add(portraitBackground(backdrop, width, height)),
    look = appearanceOf(person),
    figure = characterHead(look),
    placement = characterPortraitPlacement(look, width, height);
  figure.transform([placement.scale, 0, placement.origin.x, 0, placement.scale, placement.origin.y, 0, 0, 1]);
  frame.add(figure);
  const r = f32(Math.min(width, height) * f32(0.035));
  frame.clip(new ShapeNode().appendRect(0, 0, width, height, r, r));
  return new SceneNode().add(frame);
}
