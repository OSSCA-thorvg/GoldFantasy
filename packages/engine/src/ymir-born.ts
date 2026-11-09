import { BodyType } from './person-appearance';
export const designedWorldSeed = 5;
export const birthNotice = "Askr and Embla wake at Ymir's feet, born of the giant's stone";
export interface Founder {
  name: string;
  past: string;
  bodyType: BodyType;
}
export const foundingPeople: readonly Founder[] = [
  { name: 'Askr', past: "Born under Ymir's left arm", bodyType: BodyType.Male },
  { name: 'Embla', past: "Woke under Ymir's arm beside Askr", bodyType: BodyType.Female },
];
