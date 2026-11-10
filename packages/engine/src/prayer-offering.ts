import { Resources, resourceKeys } from './building-catalog';
import { Calling } from './person';

export const offeringKeys = ['water', 'bones', 'gold', 'food', 'stone'] as const;
export type OfferingKey = (typeof offeringKeys)[number];
export const defaultOffering = (): Resources => new Resources(0, 0, 0, 4);
export const offeringLimit = 9999;

export function offeringReason(offering: Resources): string {
  if (
    resourceKeys.some(
      (key) => !Number.isInteger(offering[key]) || offering[key] < 0 || offering[key] > offeringLimit,
    )
  )
    return 'Offering amounts must be whole numbers between 0 and 9999.';
  if (resourceKeys.some((key) => !offeringKeys.includes(key as OfferingKey) && offering[key] !== 0))
    return 'Only water, bones, gold, food and stone can be offered.';
  if (offeringKeys.reduce((sum, key) => sum + offering[key], 0) < 4)
    return 'Offer at least 4 resources to call a new life.';
  return '';
}

/** Preview and outcome share one bounded formula; offerings never grant equipment or attack power. */
export function offeringProfile(offering: Resources) {
  const { water, bones, gold, food, stone } = offering;
  const levelMin = 1 + Math.min(3, Math.floor(Math.log2(1 + food / 8 + bones / 4))),
    levelMax = Math.min(8, levelMin + Math.floor(Math.log2(1 + (stone + gold + water) / 12))),
    specialistChance = Math.min(
      0.85,
      1 - Math.exp(-(gold + bones * 2 + stone + water * 0.5 + Math.max(0, food - 4) * 0.25) / 30),
    );
  const weights = [
    { calling: Calling.Warrior, weight: 1 + bones * 2 + stone },
    { calling: Calling.Ranger, weight: 1 + food + water },
    { calling: Calling.Mage, weight: 1 + gold * 1.5 + water },
    { calling: Calling.Cleric, weight: 1 + water * 2 + stone },
    { calling: Calling.Bard, weight: 1 + gold + food },
  ];
  const total = weights.reduce((sum, row) => sum + row.weight, 0);
  return {
    levelMin,
    levelMax,
    specialistChance,
    vitalityMin: 1 + (levelMin - 1) * 0.1,
    vitalityMax: 1 + (levelMax - 1) * 0.1,
    classes: weights.map((row) => ({
      calling: row.calling,
      chance: (specialistChance * row.weight) / total,
    })),
  };
}

export function offeringOutcome(
  offering: Resources,
  roll: () => number,
): { calling: Calling; level: number } {
  const profile = offeringProfile(offering),
    level =
      profile.levelMin +
      Math.min(
        profile.levelMax - profile.levelMin,
        Math.floor(roll() * (profile.levelMax - profile.levelMin + 1)),
      );
  let choice = roll();
  for (const row of profile.classes) {
    if (choice < row.chance) return { level, calling: row.calling };
    choice -= row.chance;
  }
  return { level, calling: Calling.Settler };
}
