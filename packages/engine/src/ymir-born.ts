import { BodyType } from './person-appearance';
export const designedWorldSeed = 5;
// After Voluspa 17-18: Odin and his brothers found an ash and an elm on the shore, without breath
// or fate, and gave them life. The statue on the founding shore and the altar are Odin's.
export const birthNotice = "Askr and Embla wake before Odin's statue: an ash and an elm he gave breath";
export interface Founder {
  name: string;
  past: string;
  /** What saves made before the story was corrected recorded as their past. */
  formerPast: string;
  bodyType: BodyType;
}
export const foundingPeople: readonly Founder[] = [
  {
    name: 'Askr',
    past: 'An ash on the shore, given breath by Odin',
    formerPast: "Born under Ymir's left arm",
    bodyType: BodyType.Male,
  },
  {
    name: 'Embla',
    past: 'An elm on the shore, woken beside Askr',
    formerPast: "Woke under Ymir's arm beside Askr",
    bodyType: BodyType.Female,
  },
];
