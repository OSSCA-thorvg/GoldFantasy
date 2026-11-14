import type { Rgb } from './building-catalog';
import { BodyType, Whiskers } from './person-appearance';

/** Hair silhouettes drawn by the likeness renderer; the first twenty follow the legacy head references. */
export enum HairCut {
  SidePart,
  LongWaves,
  SideFringe,
  WindSwept,
  CurlyCrown,
  FlippedBob,
  LongCentrePart,
  SpikyCrop,
  SoftBob,
  TwinLoops,
  Shag,
  Braids,
  LongLocks,
  ShortCentrePart,
  WildTuft,
  ShortTwinTails,
  HighBun,
  LightCrop,
  TwinBuns,
  Bald,
  Topknot,
  WarBraid,
  CrownBraid,
  SideBraid,
  Mane,
}
/** The shape of the eyes, which carry the likeness now that faces have no mouth or nose. */
export enum EyeCut {
  /** A tall dark pill. */
  Oval,
  /** A round dark eye. */
  Round,
  /** A half-moon under a flat upper lid. */
  Low,
  /** A large dark eye with an outer lash. */
  Wide,
  /** An almond drawn to a point, with a lash flicked from its outer corner. */
  Almond,
  /** An upturned arc: the closed, smiling eye. */
  Smile,
  /** A narrow slit. */
  Slit,
}
export enum BrowCut {
  None,
  Soft,
  Level,
  Stern,
  Arched,
  Heavy,
}
export enum MouthCut {
  Smile,
  Calm,
  Small,
  Wry,
  Firm,
}
export enum JawCut {
  Soft,
  Round,
  Square,
  Narrow,
}
/** Everything that tells one resident from another, for the portrait and the street figure alike. */
export interface Likeness {
  body: BodyType;
  skin: Rgb;
  hair: Rgb;
  cut: HairCut;
  jaw: JawCut;
  eyes: EyeCut;
  brows: BrowCut;
  mouth: MouthCut;
  whiskers: Whiskers;
  /** A woven band across the brow. */
  band: boolean;
  /** A linen kerchief tied over the crown, in this colour. */
  kerchief: Rgb | null;
  freckles: boolean;
  scar: boolean;
  /** Woad stripes across the cheeks. */
  paint: boolean;
  /** Lines of age beside the eyes. */
  elder: boolean;
  /** A leaf carved of their own wood, worn by the two Odin made from trees. */
  leaf: boolean;
  /** Their own wool, worn while a settler, instead of one chosen by lot. */
  wool: Rgb | null;
}
export const plainLikeness = (): Likeness => ({
  body: BodyType.Male,
  skin: { r: 233, g: 192, b: 168 },
  hair: { r: 76, g: 58, b: 47 },
  cut: HairCut.SidePart,
  jaw: JawCut.Soft,
  eyes: EyeCut.Oval,
  brows: BrowCut.Soft,
  mouth: MouthCut.Smile,
  whiskers: Whiskers.None,
  band: false,
  kerchief: null,
  freckles: false,
  scar: false,
  paint: false,
  elder: false,
  leaf: false,
  wool: null,
});
