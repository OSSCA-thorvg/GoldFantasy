import { AnimalKind } from './person';
import { f32, clamp } from './numeric';
export const animalKindCount = AnimalKind.Count;
export interface AnimalSpec { name: string; health: number; speed: number; width: number; height: number; food: number; defends: boolean; }
const specs: AnimalSpec[] = [
  { name: 'Cow', health: 5, speed: f32(.9), width: 30, height: f32(22.5), food: 18, defends: true },
  { name: 'Pig', health: 3, speed: f32(1.1), width: 24, height: 18, food: 12, defends: false },
  { name: 'Chicken', health: 1, speed: f32(1.15), width: 14, height: f32(10.5), food: 4, defends: false },
  { name: 'Wolf', health: f32(4.5), speed: f32(1.2), width: 28, height: 21, food: 8, defends: true },
  { name: 'Dog', health: f32(2.5), speed: f32(1.2), width: 24, height: 18, food: 4, defends: false },
  { name: 'Cat', health: f32(1.5), speed: f32(1.5), width: 17, height: f32(12.75), food: 2, defends: false },
];
export const animalSpec = (kind: AnimalKind): AnimalSpec => specs[clamp(kind, 0, animalKindCount - 1)];
