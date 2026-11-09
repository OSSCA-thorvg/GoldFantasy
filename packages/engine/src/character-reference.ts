import pool from '../../content/assets/characters/character-pool.json';
import library from '../../content/assets/characters/character-library.json';
import { BodyType, FaceShape, PortraitEyeForm, PortraitEyeKind, type Appearance } from './person-appearance';
import { clamp, f32 as f, hash01 } from './numeric';
export const referenceHeadCount = 19,
  faceBaseCount = 30,
  eyeReferenceCount = 20,
  earAssetCount = 30,
  hairAssetCount = 150,
  baldHairAsset = 19,
  outfitAssetCount = 14;
export enum CharacterAssetGroup {
  Original,
  Modular,
  Colour,
  Dots,
  FlatLid,
}
export enum CharacterAssetGender {
  Masculine,
  Feminine,
  Unisex,
}
const hairIndex = (i: number) => clamp(i, 0, hairAssetCount - 1),
  baseIndex = (i: number) => clamp(i, 0, faceBaseCount - 1);
export const faceBaseName = (i: number): string => pool.faces[baseIndex(i)].name;
export const headAssetName = (i: number): string => library.heads[clamp(i, 0, referenceHeadCount - 1)].name;
export const eyeAssetName = (i: number): string =>
  i >= referenceHeadCount ? 'Flat lids / elf' : headAssetName(i);
export const hairAssetName = (i: number): string => pool.looks[hairIndex(i)].name;
export const characterAssetGroup = (i: number): CharacterAssetGroup => pool.looks[hairIndex(i)].group;
export const characterAssetGender = (i: number): CharacterAssetGender => pool.looks[hairIndex(i)].gender;
export const characterAssetReady = (i: number): boolean =>
  i >= 0 && i < hairAssetCount && pool.looks[i].ready;
export const safeCharacterHairAsset = (i: number): number =>
  i < 0 || i >= hairAssetCount ? baldHairAsset : pool.looks[i].fallback;
export const characterOutfitReady = (i: number): boolean => i >= 0 && i < outfitAssetCount && i !== 10;
export const safeCharacterOutfitAsset = (i: number): number => (characterOutfitReady(i) ? i : 0);
export const outfitAssetName = (i: number): string => library.outfits[safeCharacterOutfitAsset(i)].name;
export function setCharacterHeadBase(a: Appearance, i: number): void {
  a.faceAsset = a.scalpAsset = baseIndex(i);
  a.scalpWidth = a.scalpHeight = a.templeWidth = 1;
  a.foreheadShift = 0;
  a.scalpTarget = a.jawTarget = 255;
  a.scalpBlend = a.jawBlend = 0;
}
export function resolveCharacterAssets(a: Appearance): void {
  a.hairAsset = safeCharacterHairAsset(a.hairAsset);
  a.outfitAsset = safeCharacterOutfitAsset(a.outfitAsset);
  a.hairCap = a.hairFringe = a.hairBack = a.hairTied = 255;
}
export function characterAssetWeight(i: number, gender: BodyType): number {
  if (!characterAssetReady(i)) return 0;
  if (i === baldHairAsset) return f(0.25);
  const h = pool.looks[hairIndex(i)],
    family = [5, f(0.35), 1, f(1.5), 2][h.group];
  return f(family * (h.gender === 2 ? 4 : h.gender === gender ? 8 : 1));
}
export function randomCharacterReference(seed: number, gender: BodyType): number {
  let total = 0;
  for (let i = 0; i < hairAssetCount; i++) total = f(total + characterAssetWeight(i, gender));
  let value = f(hash01(seed, 0, 17, 0x6a17) * total);
  for (let i = 0; i < hairAssetCount; i++) {
    value = f(value - characterAssetWeight(i, gender));
    if (value <= 0) return i;
  }
  return baldHairAsset;
}
export function useCharacterReference(a: Appearance, i: number): void {
  i = safeCharacterHairAsset(i);
  const source = pool.looks[hairIndex(i)];
  setCharacterHeadBase(a, source.native_face);
  a.hairAsset = hairIndex(i);
  a.earAsset = source.native_face;
  a.eyeReference = a.browReference = source.eye;
  a.hairCap = a.hairFringe = a.hairBack = a.hairTied = 255;
  a.faceWidth = f(0.5);
  a.jaw = f(0.4);
  a.jawWidth = a.chinLength = 1;
  a.faceShape = FaceShape.Natural;
  a.faceBlend = 0;
  a.cheekFullness = f(0.5);
  a.hairLength = 1;
  a.sideLockGap = 0;
  a.earScale = 1;
  a.earHeight = a.earTilt = 0;
  a.eyeSize = a.eyeWidth = a.eyeHeight = a.eyeOpenness = a.eyeStroke = a.irisSize = 1;
  a.eyeGap = f(8.4);
  a.eyeLevel = a.eyeTilt = a.eyeRoundness = a.lidDrop = 0;
  a.pupilHeight = f(1.35);
  a.pupilY = f(-0.22);
  a.upperLid = true;
  a.portraitEyeKind = source.group === 4 ? PortraitEyeKind.Open : PortraitEyeKind.Dots;
  a.portraitEyeForm = source.group === 4 ? PortraitEyeForm.Reference : PortraitEyeForm.Round;
  a.eyeOutline = a.browVisible = source.group === 4;
  a.browWidth = a.browSpacing = a.browWeight = 1;
  a.browHeight = a.browTilt = a.browCurve = 0;
  a.mouthWidth = 6;
  a.mouthCurve = 0;
  a.lipFullness = a.noseScale = 1;
}
