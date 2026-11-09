import type { Rgb } from './building-catalog';
export enum HairStyle { Crop, Swept, Long, Ponytail, Bun, Braids, Wild, Bald, Bob, TwinTails, Straight }
export enum Headwear { None, Kerchief, Cap, Helmet, Hood, PointedHat, Circlet, WideBrim }
export enum Nose { Button, Straight, Broad, Hooked }
export enum Whiskers { None, Stubble, Moustache, Beard, LongBeard }
export enum EyeStyle { Round, Feline, Hooded, Arcane, Almond, Relaxed, Soft, Reflective }
export enum FaceShape { Natural, Oval, Round, Angular }
export enum MouthStyle { Smile, Neutral, Pout, Small }
export enum FringeStyle { Natural, SidePart, Curtain, Blunt, Textured }
export enum HairFinish { Flat, Gradient, Strands, Halftone }
export enum BodyType { Male, Female }
export enum PortraitEyeKind { Dots, Open }
export enum PortraitEyeForm { Round, Almond, HalfLid, Reference }
export interface Appearance {
  skin: Rgb; skinShade: Rgb; hair: Rgb; hairShade: Rgb; eyes: Rgb; cloth: Rgb; clothShade: Rgb; trim: Rgb;
  hairStyle: HairStyle; headwear: Headwear; nose: Nose; whiskers: Whiskers; eyeStyle: EyeStyle;
  faceWidth: number; jaw: number; eyeSize: number; eyeGap: number; browWeight: number; mouthWidth: number;
  jawWidth: number; chinLength: number; bodyHeight: number; bodyWidth: number;
  freckles: boolean; scar: boolean; earring: boolean; old: boolean; eyepatch: boolean; warpaint: boolean;
  tippedHair: boolean; comely: boolean; pointedEars: boolean; slitPupils: boolean; seed: number;
  faceShape: FaceShape; mouthStyle: MouthStyle; fringeStyle: FringeStyle; hairFinish: HairFinish; hairEnd: Rgb;
  irisSize: number; eyeTilt: number; cheekFullness: number; lipFullness: number;
  eyeWidth: number; eyeHeight: number; eyeLevel: number; lidDrop: number; noseScale: number; earScale: number; equipmentScale: number;
  bodyType: BodyType; faceAsset: number; hairAsset: number; eyeReference: number; outfitAsset: number; earAsset: number; scalpAsset: number;
  scalpWidth: number; scalpHeight: number; foreheadShift: number; templeWidth: number;
  hairCap: number; hairFringe: number; hairBack: number; hairTied: number; hairLength: number; sideLockGap: number; earTilt: number; earHeight: number;
  faceBlend: number; eyeOpenness: number; eyeRoundness: number; eyeStroke: number; mouthCurve: number; scalpTarget: number; jawTarget: number; scalpBlend: number; jawBlend: number;
  portraitEyeKind: PortraitEyeKind; portraitEyeForm: PortraitEyeForm; eyeOutline: boolean; upperLid: boolean; browVisible: boolean; browReference: number;
  pupilHeight: number; pupilY: number; browWidth: number; browSpacing: number; browHeight: number; browTilt: number; browCurve: number;
}
