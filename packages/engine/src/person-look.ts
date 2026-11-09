import type { Rgb } from './building-catalog';
export enum Mood { Content, Cheerful, Tired, Exhausted, Hungry, Stressed, Hurt, Asleep, Fierce }
import { Person } from './person';
import {
  BodyType,
  FaceShape,
  MouthStyle,
  Nose,
  PortraitEyeForm,
  PortraitEyeKind,
  Whiskers,
  type Appearance,
} from './person-appearance';
import {
  characterAssetGender,
  CharacterAssetGender,
  randomCharacterReference,
  resolveCharacterAssets,
  useCharacterReference,
} from './character-reference';
import { f32 as f, hash01 } from './numeric';
export const rgb = (r = 0, g = 0, b = 0): Rgb => ({ r, g, b });
export function scaleColor(c: Rgb, k: number): Rgb {
  k = f(k);
  return rgb(
    Math.trunc(Math.min(255, f(c.r * k))),
    Math.trunc(Math.min(255, f(c.g * k))),
    Math.trunc(Math.min(255, f(c.b * k))),
  );
}
export function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  t = f(t);
  return rgb(
    Math.trunc(f(a.r + f(f(b.r - a.r) * t))),
    Math.trunc(f(a.g + f(f(b.g - a.g) * t))),
    Math.trunc(f(a.b + f(f(b.b - a.b) * t))),
  );
}
/** Value-initialized native Appearance, including the header's member defaults. */
export function defaultAppearance(): Appearance {
  return {
    skin: rgb(),
    skinShade: rgb(),
    hair: rgb(),
    hairShade: rgb(),
    eyes: rgb(),
    cloth: rgb(),
    clothShade: rgb(),
    trim: rgb(),
    hairStyle: 0,
    headwear: 0,
    nose: 0,
    whiskers: 0,
    eyeStyle: 0,
    faceWidth: 0,
    jaw: 0,
    eyeSize: 0,
    eyeGap: 0,
    browWeight: 0,
    mouthWidth: 0,
    jawWidth: 1,
    chinLength: 1,
    bodyHeight: 1,
    bodyWidth: 1,
    freckles: false,
    scar: false,
    earring: false,
    old: false,
    eyepatch: false,
    warpaint: false,
    tippedHair: false,
    comely: false,
    pointedEars: false,
    slitPupils: false,
    seed: 0,
    faceShape: 0,
    mouthStyle: 0,
    fringeStyle: 0,
    hairFinish: 0,
    hairEnd: rgb(180, 150, 120),
    irisSize: 1,
    eyeTilt: 0,
    cheekFullness: f(0.5),
    lipFullness: 1,
    eyeWidth: 1,
    eyeHeight: 1,
    eyeLevel: 0,
    lidDrop: 0,
    noseScale: 1,
    earScale: 1,
    equipmentScale: 1,
    bodyType: 0,
    faceAsset: 0,
    hairAsset: 0,
    eyeReference: 0,
    outfitAsset: 0,
    earAsset: 0,
    scalpAsset: 0,
    scalpWidth: 1,
    scalpHeight: 1,
    foreheadShift: 0,
    templeWidth: 1,
    hairCap: 255,
    hairFringe: 255,
    hairBack: 255,
    hairTied: 255,
    hairLength: 1,
    sideLockGap: 0,
    earTilt: 0,
    earHeight: 0,
    faceBlend: 0,
    eyeOpenness: 1,
    eyeRoundness: 0,
    eyeStroke: 1,
    mouthCurve: 0,
    scalpTarget: 255,
    jawTarget: 255,
    scalpBlend: 0,
    jawBlend: 0,
    portraitEyeKind: 0,
    portraitEyeForm: 0,
    eyeOutline: false,
    upperLid: true,
    browVisible: false,
    browReference: 0,
    pupilHeight: f(1.35),
    pupilY: f(-0.22),
    browWidth: 1,
    browSpacing: 1,
    browHeight: 0,
    browTilt: 0,
    browCurve: 0,
  };
}
export enum Injury {
  None,
  Scratched,
  Bruised,
  Bandaged,
}
export const injuryOf = (p: Person): Injury =>
  p.health < f(0.35)
    ? Injury.Bandaged
    : p.health < f(0.6)
      ? Injury.Bruised
      : p.health < f(0.85)
        ? Injury.Scratched
        : Injury.None;
export const headBody = (head: number): BodyType =>
  characterAssetGender(head) === CharacterAssetGender.Feminine ? BodyType.Female : BodyType.Male;
export function appearanceOf(person: Person): Appearance {
  if (person.customLook) {
    const look = structuredClone(person.customLook);
    resolveCharacterAssets(look);
    return look;
  }
  const roll = (salt: number) => hash01(person.look, 0, salt, 0x5eed),
    skins = [
      rgb(240, 205, 179),
      rgb(231, 183, 159),
      rgb(211, 153, 130),
      rgb(183, 126, 100),
      rgb(151, 98, 76),
      rgb(109, 73, 57),
    ],
    hair = [
      rgb(34, 35, 34),
      rgb(67, 55, 46),
      rgb(106, 91, 76),
      rgb(164, 91, 54),
      rgb(207, 183, 126),
      rgb(224, 222, 209),
    ],
    cloth = [
      rgb(96, 106, 99),
      rgb(76, 87, 83),
      rgb(102, 108, 110),
      rgb(85, 99, 88),
      rgb(70, 87, 98),
      rgb(115, 118, 113),
      rgb(106, 92, 80),
    ];
  const a = defaultAppearance();
  a.seed = person.look;
  a.bodyType = roll(5) < f(0.5) ? BodyType.Male : BodyType.Female;
  useCharacterReference(a, randomCharacterReference(person.look, a.bodyType));
  a.outfitAsset = person.calling;
  a.skin = skins[Math.trunc(f(roll(2) * skins.length)) % skins.length];
  a.skinShade = mixColor(a.skin, rgb(123, 81, 69), f(0.18));
  a.hair = hair[Math.trunc(f(roll(3) * hair.length)) % hair.length];
  a.hairShade = scaleColor(a.hair, f(0.42));
  a.hairEnd = { ...a.hair };
  a.eyes = rgb(20, 23, 22);
  a.cloth = cloth[person.calling];
  a.clothShade = scaleColor(a.cloth, f(0.68));
  a.trim = rgb(146, 130, 99);
  a.faceWidth = f(0.5);
  a.jaw = f(0.4);
  a.eyeSize = 1;
  a.eyeGap = f(8.4);
  a.browWeight = 1;
  a.mouthWidth = 6;
  a.mouthStyle = MouthStyle.Neutral;
  return a;
}
export function founderAppearance(person: Person, type: BodyType): Appearance {
  const a = appearanceOf(person),
    male = type === BodyType.Male;
  useCharacterReference(a, male ? 0 : 6);
  a.bodyType = type;
  a.bodyWidth = f(male ? 1.2 : 1.15);
  a.bodyHeight = f(male ? 1.1 : 1.06);
  a.outfitAsset = male ? 1 : 0;
  a.faceWidth = f(male ? 0.92 : 0.72);
  a.jawWidth = f(male ? 1.14 : 1.06);
  a.chinLength = f(male ? 1.05 : 1.02);
  a.jawTarget = 21;
  a.jawBlend = f(male ? 0.32 : 0.12);
  a.cheekFullness = f(male ? 0.62 : 0.7);
  a.faceShape = FaceShape.Angular;
  a.faceBlend = f(male ? 0.25 : 0.08);
  a.earAsset = 0;
  a.earScale = f(0.82);
  a.skin = male ? rgb(245, 218, 197) : rgb(248, 224, 205);
  a.hair = male ? rgb(183, 164, 123) : rgb(201, 172, 113);
  a.hairEnd = { ...a.hair };
  a.skinShade = mixColor(scaleColor(a.skin, f(0.84)), rgb(169, 123, 105), f(0.12));
  a.hairShade = scaleColor(a.hair, f(0.66));
  a.eyes = male ? rgb(81, 122, 145) : rgb(83, 131, 145);
  a.cloth = male ? rgb(76, 94, 88) : rgb(91, 106, 94);
  a.clothShade = scaleColor(a.cloth, f(0.68));
  a.trim = rgb(160, 127, 76);
  a.eyeReference = a.browReference = 0;
  a.portraitEyeKind = PortraitEyeKind.Open;
  a.portraitEyeForm = PortraitEyeForm.Round;
  a.eyeSize = f(male ? 0.86 : 0.92);
  a.eyeWidth = f(1.08);
  a.eyeHeight = f(0.8);
  a.eyeOpenness = f(0.94);
  a.eyeGap = f(8.7);
  a.eyeLevel = f(male ? -0.04 : 0.36);
  a.eyeTilt = 0;
  a.irisSize = f(1.25);
  a.pupilHeight = f(1.55);
  a.pupilY = f(-0.18);
  a.eyeOutline = false;
  a.upperLid = a.browVisible = true;
  a.eyeStroke = f(0.85);
  a.browWeight = f(male ? 1.75 : 1.25);
  a.browWidth = f(male ? 1.08 : 1.04);
  a.browHeight = f(male ? 0.32 : 0.5);
  a.browTilt = 0;
  a.nose = Nose.Straight;
  a.noseScale = f(1.12);
  a.mouthStyle = MouthStyle.Neutral;
  a.old = a.pointedEars = a.slitPupils = a.eyepatch = a.warpaint = a.scar = false;
  a.whiskers = Whiskers.None;
  a.freckles = !male;
  return a;
}
