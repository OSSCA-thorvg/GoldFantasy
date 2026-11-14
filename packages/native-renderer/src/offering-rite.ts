import { OfferingGrade } from '../../engine/src/prayer-offering';

/** Seconds at which each beat of the rite starts; higher grades take longer and gather more light. */
export interface RiteTimeline {
  grade: OfferingGrade;
  /** When each gift lands on the table, in laying order. */
  lays: number[];
  /** When each worshipper begins to bow. */
  bows: number[];
  /** The ravens arrive and the light starts to gather. */
  answer: number;
  /** The light breaks and the newcomer is made; the town commits here. */
  release: number;
  reveal: number;
  /** The newcomer steps from the table toward the worshippers. */
  join: number;
  end: number;
}

const layStep = 0.3,
  firstLay = 0.3,
  bowStep = [0.25, 0.35, 0.45, 0.5],
  bowHold = 1.0,
  gather = [0.9, 1.4, 1.9, 2.5],
  afterRelease = [2.0, 2.2, 2.5, 2.8];

export function riteTimeline(grade: OfferingGrade, gifts: number, worshippers: number): RiteTimeline {
  const lays = Array.from({ length: Math.max(1, gifts) }, (_, i) => firstLay + layStep * i),
    layEnd = lays[lays.length - 1] + 0.5,
    bows = Array.from({ length: Math.max(1, worshippers) }, (_, i) => layEnd + bowStep[grade] * i),
    answer = bows[bows.length - 1] + bowHold - 0.3,
    release = answer + gather[grade];
  return {
    grade,
    lays,
    bows,
    answer,
    release,
    reveal: release,
    join: release + 0.9,
    end: release + afterRelease[grade],
  };
}

/** Ravens that answer the prayer: none for a humble gift. */
export const ravensFor = (grade: OfferingGrade): number => [0, 1, 2, 2][grade];
