import { Resources, Structure } from './building-catalog';
import type { Building } from './town-models';

/** A station's step up to `level`: paid and worked at the station like any recipe. */
export interface StationStep {
  level: number;
  cost: Resources;
  /** Work in item seconds, at the crafter's crafting pace. */
  seconds: number;
  /** What the new level opens, for the player. */
  opens: string;
  /** Residents the settlement needs. */
  residents: number;
  /** Buildings that must stand first. */
  after: readonly Structure[];
  /** Floors cleared beyond the gates. */
  floors: number;
  /** Another station and the level it must have reached. */
  station: { kind: Structure; level: number } | null;
}
const step = (level: number, cost: Resources, seconds: number, opens: string, data: Partial<StationStep> = {}): StationStep => ({
  level,
  cost,
  seconds,
  opens,
  residents: 0,
  after: [],
  floors: 0,
  station: null,
  ...data,
});
const benchSteps: readonly StationStep[] = [
  step(2, new Resources(0, 10, 6), 20, 'stone tools, a flint sickle and a hunting knife'),
  step(3, new Resources(0, 0, 0, 0, 0, 0, 6, 4), 30, 'iron tools, a saw and a watering can', {
    residents: 8,
    station: { kind: Structure.Weaponsmith, level: 2 },
  }),
];
const smithySteps: readonly StationStep[] = [
  step(2, new Resources(0, 16, 12), 30, 'stone weapons, a reinforced shield and stone-studded armor', {
    residents: 4,
    after: [Structure.Quarry],
  }),
  step(3, new Resources(20, 0, 0, 0, 0, 0, 8, 8), 40, 'iron weapons, an iron shield, mail armor and an iron helmet', {
    residents: 8,
    floors: 1,
  }),
];
/** The highest level a craft station of `kind` can reach; 0 for buildings that are not stations. */
export function topLevel(kind: Structure): number {
  return kind === Structure.Workbench || kind === Structure.Weaponsmith ? 3 : kind === Structure.Armorer ? 3 : 0;
}
// A station's level is its look: the low variant bits pick the asset's level-by-level variant (as the chapel's faith does).
export function stationLevel(b: Pick<Building, 'kind' | 'variant'>): number {
  const top = topLevel(b.kind);
  return top ? ((b.variant >>> 0) % top) + 1 : 0;
}
export const levelVariant = (level: number): number => Math.max(0, level - 1);
/** The step that raises a station of `kind` to `level`, or null when there is none. */
export function stationStep(kind: Structure, level: number): StationStep | null {
  const steps = kind === Structure.Workbench ? benchSteps : kind === Structure.Weaponsmith ? smithySteps : [];
  return steps.find((s) => s.level === level) ?? null;
}
/** Every station step, for checks that hold for all of them. */
export const stationSteps = (): readonly StationStep[] => [...benchSteps, ...smithySteps];
/** The longest station step, which bounds a saved order's progress. */
export const longestStationStep = (): number => Math.max(...stationSteps().map((s) => s.seconds));
/** The station's name with its level, as the panel heads it ("Smithy · Level 2"). */
export const stationTitle = (name: string, level: number): string => `${name} · Level ${level}`;
