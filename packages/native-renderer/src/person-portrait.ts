import { Person, Activity } from '../../engine/src/person';
import { Mood } from '../../engine/src/person-look';
export { Mood } from '../../engine/src/person-look';
import { likenessOf } from '../../engine/src/character-cast';
import { equippedItem } from '../../engine/src/equipment';
import { f32 } from '../../engine/src/numeric';
import { SceneNode, ShapeNode } from './paint';
import { drawBust } from './calling-bust';
import { wardrobeOf } from './calling-garments';
import { drawHead, expressionOf, portraitFinish } from './likeness-head';
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
  mood: Mood,
  width: number,
  height: number,
  backdrop: PortraitBackdrop,
): SceneNode {
  const frame = new SceneNode().add(portraitBackground(backdrop, width, height)),
    look = likenessOf(person),
    // What is really worn shows here as it does on the street figure.
    gear = equippedItem(person, 'head')?.id,
    armour = equippedItem(person, 'body')?.id,
    head = drawHead(
      look,
      portraitFinish,
      expressionOf(look, mood),
      gear === 'cap' || gear === 'helmet' ? gear : null,
    ),
    bust = drawBust(
      look,
      wardrobeOf(person),
      portraitFinish,
      armour === 'leather-armor' || armour === 'mail-armor' ? armour : null,
    ),
    figure = new SceneNode().add(bust.back).add(head.back).add(bust.front).add(head.front),
    // The head fills most of the frame; the shoulders carry the calling.
    scale = Math.min(f32(width * f32(0.335)), f32(height * f32(0.262)));
  figure.transform([scale, 0, f32(width * f32(0.5)), 0, scale, f32(height * f32(0.47)), 0, 0, 1]);
  frame.add(figure);
  const r = f32(Math.min(width, height) * f32(0.035));
  frame.clip(new ShapeNode().appendRect(0, 0, width, height, r, r));
  return new SceneNode().add(frame);
}
