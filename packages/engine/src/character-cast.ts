import type { Rgb } from './building-catalog';
import { Calling, type Person } from './person';
import { BodyType, Whiskers, type Appearance } from './person-appearance';
import { safeCharacterHairAsset } from './character-reference';
import { foundingPeople } from './ymir-born';
import { BrowCut, EyeCut, HairCut, JawCut, MouthCut, plainLikeness, type Likeness } from './likeness';
import { hash01 } from './numeric';

const tone = (r: number, g: number, b: number): Rgb => ({ r, g, b });
export const castSkins: readonly Rgb[] = [
  tone(244, 214, 194),
  tone(233, 192, 168),
  tone(214, 164, 138),
  tone(186, 134, 108),
  tone(150, 102, 80),
  tone(114, 78, 62),
];
// Natural, low-saturation hair: raven, umber, chestnut, auburn, ash, flax, silver.
export const castHair: readonly Rgb[] = [
  tone(52, 46, 48),
  tone(86, 64, 52),
  tone(126, 86, 60),
  tone(162, 92, 62),
  tone(178, 156, 122),
  tone(218, 196, 146),
  tone(204, 202, 196),
];
const madder = tone(158, 88, 72),
  linen = tone(226, 214, 190);
type Traits = Partial<Omit<Likeness, 'body' | 'skin' | 'hair' | 'cut'>>;
const M = BodyType.Male,
  F = BodyType.Female,
  { Stubble, Moustache, Beard, LongBeard } = Whiskers,
  member = (body: BodyType, cut: HairCut, skin: number, hair: number, traits: Traits = {}): Likeness => ({
    ...plainLikeness(),
    body,
    cut,
    skin: castSkins[skin],
    hair: castHair[hair],
    ...traits,
  });
/** Hand-picked residents: each row is one whole face, never a roll of independent features. */
export const residentCast: readonly Likeness[] = [
  member(M, HairCut.SidePart, 1, 1, {
    jaw: JawCut.Square,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
    whiskers: Beard,
  }),
  member(M, HairCut.SidePart, 3, 0, { eyes: EyeCut.Round }),
  member(M, HairCut.SidePart, 1, 6, {
    jaw: JawCut.Square,
    eyes: EyeCut.Low,
    brows: BrowCut.Heavy,
    mouth: MouthCut.Firm,
    whiskers: LongBeard,
    elder: true,
  }),
  member(M, HairCut.SideFringe, 0, 4, { eyes: EyeCut.Smile, jaw: JawCut.Narrow, brows: BrowCut.None }),
  member(M, HairCut.SideFringe, 2, 2, {
    eyes: EyeCut.Round,
    brows: BrowCut.Level,
    mouth: MouthCut.Wry,
    whiskers: Stubble,
  }),
  member(M, HairCut.WindSwept, 1, 3, { brows: BrowCut.Arched, whiskers: Beard }),
  member(M, HairCut.WindSwept, 4, 0, { jaw: JawCut.Round, eyes: EyeCut.Wide }),
  member(M, HairCut.CurlyCrown, 3, 1, {
    jaw: JawCut.Round,
    eyes: EyeCut.Round,
    mouth: MouthCut.Calm,
    whiskers: Moustache,
  }),
  member(M, HairCut.CurlyCrown, 5, 0, {
    jaw: JawCut.Square,
    brows: BrowCut.Heavy,
    mouth: MouthCut.Firm,
    whiskers: Beard,
  }),
  member(M, HairCut.FlippedBob, 0, 5, {
    jaw: JawCut.Narrow,
    eyes: EyeCut.Wide,
    brows: BrowCut.None,
    mouth: MouthCut.Small,
  }),
  member(M, HairCut.Mane, 2, 1, {
    jaw: JawCut.Square,
    eyes: EyeCut.Slit,
    brows: BrowCut.Stern,
    mouth: MouthCut.Firm,
    whiskers: Beard,
    band: true,
  }),
  member(M, HairCut.SpikyCrop, 1, 2, {
    eyes: EyeCut.Slit,
    brows: BrowCut.Stern,
    mouth: MouthCut.Wry,
    paint: true,
  }),
  member(M, HairCut.SpikyCrop, 4, 1, {
    jaw: JawCut.Round,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
    whiskers: Stubble,
  }),
  member(M, HairCut.ShortCentrePart, 0, 2, { jaw: JawCut.Narrow, eyes: EyeCut.Low, mouth: MouthCut.Calm }),
  member(M, HairCut.ShortCentrePart, 2, 4, {
    jaw: JawCut.Square,
    brows: BrowCut.Heavy,
    mouth: MouthCut.Firm,
    whiskers: LongBeard,
  }),
  member(M, HairCut.WildTuft, 1, 3, {
    jaw: JawCut.Round,
    eyes: EyeCut.Wide,
    brows: BrowCut.Arched,
    freckles: true,
  }),
  member(M, HairCut.WildTuft, 3, 1, {
    jaw: JawCut.Square,
    eyes: EyeCut.Slit,
    brows: BrowCut.Stern,
    mouth: MouthCut.Firm,
    whiskers: Beard,
    scar: true,
  }),
  member(M, HairCut.LightCrop, 0, 4, { brows: BrowCut.Level, mouth: MouthCut.Wry, whiskers: Moustache }),
  member(M, HairCut.LightCrop, 5, 0, { jaw: JawCut.Round, eyes: EyeCut.Round }),
  member(M, HairCut.Bald, 2, 1, {
    jaw: JawCut.Square,
    eyes: EyeCut.Low,
    brows: BrowCut.Heavy,
    mouth: MouthCut.Calm,
    whiskers: LongBeard,
    elder: true,
  }),
  member(M, HairCut.Topknot, 1, 3, {
    eyes: EyeCut.Slit,
    brows: BrowCut.Stern,
    mouth: MouthCut.Firm,
    whiskers: Beard,
    paint: true,
  }),
  member(M, HairCut.WarBraid, 4, 0, {
    jaw: JawCut.Narrow,
    eyes: EyeCut.Round,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
  }),
  member(M, HairCut.Shag, 2, 2, { eyes: EyeCut.Smile, whiskers: Stubble }),
  member(M, HairCut.Mane, 0, 5, {
    jaw: JawCut.Narrow,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
    whiskers: Moustache,
  }),
  member(F, HairCut.LongWaves, 0, 3, { eyes: EyeCut.Almond, brows: BrowCut.Arched }),
  member(F, HairCut.LongWaves, 2, 1, { eyes: EyeCut.Smile, jaw: JawCut.Round, mouth: MouthCut.Calm }),
  member(F, HairCut.LongCentrePart, 1, 5, {
    eyes: EyeCut.Smile,
    jaw: JawCut.Narrow,
    brows: BrowCut.None,
    band: true,
  }),
  member(F, HairCut.LongCentrePart, 4, 0, { eyes: EyeCut.Round, brows: BrowCut.Level, mouth: MouthCut.Calm }),
  member(F, HairCut.SoftBob, 0, 2, { jaw: JawCut.Round, eyes: EyeCut.Wide, mouth: MouthCut.Small }),
  member(F, HairCut.SoftBob, 3, 1, {
    eyes: EyeCut.Almond,
    brows: BrowCut.Arched,
    mouth: MouthCut.Wry,
    kerchief: madder,
  }),
  member(F, HairCut.TwinLoops, 1, 4, { jaw: JawCut.Narrow, eyes: EyeCut.Round, freckles: true }),
  member(F, HairCut.TwinLoops, 2, 2, { eyes: EyeCut.Low, brows: BrowCut.Level, mouth: MouthCut.Calm }),
  member(F, HairCut.Braids, 0, 5, { jaw: JawCut.Round, eyes: EyeCut.Wide, kerchief: madder }),
  member(F, HairCut.Braids, 1, 3, {
    eyes: EyeCut.Almond,
    brows: BrowCut.Arched,
    mouth: MouthCut.Wry,
    paint: true,
  }),
  member(F, HairCut.LongLocks, 3, 0, {
    jaw: JawCut.Narrow,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
    band: true,
  }),
  member(F, HairCut.LongLocks, 5, 1, { jaw: JawCut.Round, eyes: EyeCut.Round }),
  member(F, HairCut.ShortTwinTails, 1, 2, {
    jaw: JawCut.Round,
    eyes: EyeCut.Wide,
    brows: BrowCut.None,
    mouth: MouthCut.Small,
    freckles: true,
  }),
  member(F, HairCut.ShortTwinTails, 0, 4, { eyes: EyeCut.Round }),
  member(F, HairCut.HighBun, 2, 1, { eyes: EyeCut.Low, brows: BrowCut.Level, mouth: MouthCut.Firm }),
  member(F, HairCut.HighBun, 4, 0, {
    eyes: EyeCut.Almond,
    jaw: JawCut.Narrow,
    brows: BrowCut.Arched,
    mouth: MouthCut.Calm,
  }),
  member(F, HairCut.HighBun, 1, 6, { jaw: JawCut.Round, eyes: EyeCut.Low, elder: true }),
  member(F, HairCut.TwinBuns, 0, 3, { jaw: JawCut.Round, eyes: EyeCut.Wide }),
  member(F, HairCut.TwinBuns, 3, 1, { brows: BrowCut.Stern, mouth: MouthCut.Wry, scar: true }),
  member(F, HairCut.CrownBraid, 1, 5, { eyes: EyeCut.Smile, mouth: MouthCut.Calm }),
  member(F, HairCut.SideBraid, 2, 2, { jaw: JawCut.Narrow, eyes: EyeCut.Almond, brows: BrowCut.Arched }),
  member(F, HairCut.Shag, 0, 0, { eyes: EyeCut.Low, brows: BrowCut.Level, mouth: MouthCut.Small }),
  member(F, HairCut.CrownBraid, 4, 1, { jaw: JawCut.Round, eyes: EyeCut.Wide }),
  member(F, HairCut.SideBraid, 1, 6, {
    eyes: EyeCut.Low,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
    elder: true,
    kerchief: linen,
  }),
];
export const castMember = (seed: number): Likeness =>
  residentCast[
    Math.min(residentCast.length - 1, Math.trunc(hash01(seed, 0, 17, 0x6a17) * residentCast.length))
  ];

/** The first two, an ash and an elm Odin gave breath: each wears a leaf carved of its own wood. */
export const founderCast: readonly Likeness[] = [
  {
    ...plainLikeness(),
    body: M,
    skin: tone(240, 206, 182),
    hair: tone(190, 170, 130),
    cut: HairCut.Mane,
    jaw: JawCut.Square,
    brows: BrowCut.Level,
    mouth: MouthCut.Calm,
    whiskers: Beard,
    leaf: true,
    wool: tone(88, 114, 128),
  },
  {
    ...plainLikeness(),
    body: F,
    skin: tone(246, 216, 196),
    hair: tone(172, 98, 62),
    cut: HairCut.SideBraid,
    eyes: EyeCut.Round,
    brows: BrowCut.Arched,
    freckles: true,
    leaf: true,
    wool: tone(106, 124, 90),
  },
];

/** The legacy reference head closest to a cut, for the old studio and its saved presets. */
export const legacyHairAsset = (cut: HairCut): number =>
  cut < HairCut.Topknot && cut !== HairCut.Shag
    ? cut
    : ({
        [HairCut.Shag]: 14,
        [HairCut.Topknot]: 19,
        [HairCut.WarBraid]: 19,
        [HairCut.CrownBraid]: 16,
        [HairCut.SideBraid]: 6,
        [HairCut.Mane]: 5,
      }[cut as number] ?? 0);
/** A look saved by the old studio, read as closely as the new drawing allows. */
function likenessOfAppearance(a: Appearance): Likeness {
  const asset = safeCharacterHairAsset(a.hairAsset);
  return {
    ...plainLikeness(),
    body: a.bodyType,
    skin: { ...a.skin },
    hair: { ...a.hair },
    cut: asset < HairCut.Topknot ? asset : HairCut.SidePart,
    eyes:
      a.eyeHeight < 0.7
        ? EyeCut.Low
        : a.eyeSize > 1.3
          ? EyeCut.Wide
          : a.eyeHeight < 0.9
            ? EyeCut.Round
            : EyeCut.Oval,
    brows: !a.browVisible
      ? BrowCut.None
      : a.browWeight > 1.5
        ? BrowCut.Heavy
        : a.browTilt < -0.1
          ? BrowCut.Stern
          : BrowCut.Level,
    mouth: a.mouthCurve > 0.25 ? MouthCut.Smile : a.mouthCurve < -0.05 ? MouthCut.Firm : MouthCut.Calm,
    whiskers: a.whiskers,
    freckles: a.freckles,
    scar: a.scar,
    paint: a.warpaint,
  };
}
/** How a person is drawn: a founder, a look saved by the old studio, or a member of the cast. */
export function likenessOf(person: Person): Likeness {
  const founder = foundingPeople.findIndex(
    (f) => f.name === person.name && (f.past === person.past || f.formerPast === person.past),
  );
  if (founder >= 0 && founder < founderCast.length) return founderCast[founder];
  return person.customLook ? likenessOfAppearance(person.customLook) : castMember(person.look);
}

export interface CallingOutfit {
  cloth: Rgb;
  trim: Rgb;
}
// Settlers wear one of a few home-dyed wools; every other calling has its own colours.
const settlerWool: readonly Rgb[] = [
  tone(88, 114, 128),
  tone(106, 124, 90),
  tone(156, 94, 78),
  tone(190, 152, 86),
  tone(136, 112, 92),
];
const outfits: Record<Calling, CallingOutfit> = {
  [Calling.Settler]: { cloth: settlerWool[0], trim: linen },
  [Calling.Traveller]: { cloth: tone(124, 122, 98), trim: tone(170, 100, 76) },
  [Calling.Warrior]: { cloth: tone(152, 72, 64), trim: tone(150, 156, 164) },
  [Calling.Ranger]: { cloth: tone(84, 110, 82), trim: tone(132, 98, 62) },
  [Calling.Mage]: { cloth: tone(66, 86, 124), trim: tone(204, 168, 96) },
  [Calling.Cleric]: { cloth: tone(228, 218, 198), trim: tone(202, 164, 88) },
  [Calling.Bard]: { cloth: tone(142, 84, 110), trim: tone(224, 188, 98) },
};
export function callingOutfit(calling: Calling, seed: number, wool: Rgb | null = null): CallingOutfit {
  const outfit = outfits[calling] ?? outfits[Calling.Settler];
  if (calling !== Calling.Settler) return outfit;
  if (wool) return { cloth: wool, trim: outfit.trim };
  return {
    cloth: settlerWool[Math.trunc(hash01(seed, 0, 23, 0x6a17) * settlerWool.length) % settlerWool.length],
    trim: outfit.trim,
  };
}
