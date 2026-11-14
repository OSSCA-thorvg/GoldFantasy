import { Resources, resourceKeys } from './building-catalog';
import { Calling, Person, callingName } from './person';

export const offeringKeys = ['water', 'bones', 'gold', 'food', 'stone'] as const;
export type OfferingKey = (typeof offeringKeys)[number];
/** The altar starts bare; the player lays what they choose. */
export const defaultOffering = (): Resources => new Resources();
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
    vitalityMin: 1 + (levelMin - 1) * Person.vitalityPerLevel,
    vitalityMax: 1 + (levelMax - 1) * Person.vitalityPerLevel,
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

export enum OfferingGrade {
  Humble,
  Worthy,
  Bountiful,
  Kingly,
}
/** Name, how it reads mid-sentence, and what such a gift tends to bring, in plain words. */
const gradeWords = [
  { name: 'Humble', lower: 'humble', line: 'A small gift. It tends to bring a plain settler.' },
  { name: 'Worthy', lower: 'worthy', line: 'A fair gift. It tends to bring a settler with some skill.' },
  {
    name: 'Bountiful',
    lower: 'bountiful',
    line: 'A rich gift. It tends to bring a gifted and hardy resident.',
  },
  { name: 'Kingly', lower: 'kingly', line: 'A gift fit for a king. It tends to bring a hero.' },
] as const;
/** Lowest score of each grade after Humble; the score is the level ceiling plus the odds of a calling. */
const gradeFloors = [3, 5, 7] as const;

/** Worth of an offering from its profile alone: more levels and a better chance of a calling raise it. */
export const offeringScore = (profile: ReturnType<typeof offeringProfile>): number =>
  profile.levelMax + 3 * profile.specialistChance;

export function gradeOfScore(score: number): OfferingGrade {
  let grade = OfferingGrade.Humble;
  for (const floor of gradeFloors) if (score >= floor) ++grade;
  return grade;
}
export const gradeName = (grade: OfferingGrade): string => gradeWords[grade].name;
export const gradeNameInSentence = (grade: OfferingGrade): string => gradeWords[grade].lower;
export const offeringAcceptedText = (grade: OfferingGrade): string =>
  `A ${gradeWords[grade].lower} offering was accepted.`;

/** The calling the gifts favour, or null when they barely favour any. */
export function favouredCalling(profile: ReturnType<typeof offeringProfile>): Calling | null {
  if (profile.specialistChance < 0.05) return null;
  return profile.classes.reduce((best, row) => (row.chance > best.chance ? row : best)).calling;
}

/** The fewest extra units of one resource that lift the offering to `target`, or -1 within `room`. */
function topUp(offering: Resources, key: OfferingKey, target: OfferingGrade, room: number): number {
  const reaches = (extra: number) => {
    const gift = offering.clone();
    gift[key] += extra;
    return gradeOfScore(offeringScore(offeringProfile(gift))) >= target;
  };
  if (room <= 0 || !reaches(room)) return -1;
  let low = 1,
    high = room;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (reaches(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

export interface OfferingGradeReading {
  grade: OfferingGrade;
  name: string;
  line: string;
  favoured: Calling | null;
  /** The resource that is quickest to add for the next grade, or null at the top or when the stores fall short. */
  next: { grade: OfferingGrade; resource: OfferingKey } | null;
}

/** Plain-words reading of an offering; never changes the profile, so birth rules and odds are untouched. */
export function offeringGradeOf(offering: Resources, stock?: Resources): OfferingGradeReading {
  const profile = offeringProfile(offering),
    grade = gradeOfScore(offeringScore(profile)),
    reading: OfferingGradeReading = {
      grade,
      name: gradeWords[grade].name,
      line: gradeWords[grade].line,
      favoured: favouredCalling(profile),
      next: null,
    };
  if (grade === OfferingGrade.Kingly) return reading;
  const target = grade + 1;
  let fewest = Infinity;
  for (const key of offeringKeys) {
    const room = Math.min(offeringLimit - offering[key], stock ? stock[key] - offering[key] : Infinity),
      need = topUp(offering, key, target, room);
    if (need > 0 && need < fewest) {
      fewest = need;
      reading.next = { grade: target, resource: key };
    }
  }
  return reading;
}
export const favouredLine = (calling: Calling): string => `Leans toward ${callingName(calling)}s.`;

/** Chance that Odin turns an offering of this grade away: the gifts are spent and no one comes. */
export const refusalChances = [0.35, 0.15, 0.05, 0] as const;
const refusalWords = ['Often refused', 'Sometimes refused', 'Rarely refused', 'Never refused'] as const;
export const refusalWord = (grade: OfferingGrade): string => refusalWords[grade];
/** A roll in [0, 1) refuses when it falls in the top slice, so a roll of 0 never refuses. */
export const offeringRefused = (grade: OfferingGrade, roll: number): boolean =>
  roll >= 1 - refusalChances[grade];
