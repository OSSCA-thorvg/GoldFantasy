import { Calling, Person, Race } from './person';
import type { Appearance } from './person-appearance';
import {
  BodyType,
  EyeStyle,
  HairStyle,
  Headwear,
  Nose,
  Whiskers,
  FaceShape,
  MouthStyle,
  FringeStyle,
  HairFinish,
  PortraitEyeKind,
  PortraitEyeForm,
} from './person-appearance';
import { appearanceOf, defaultAppearance, mixColor, rgb, scaleColor } from './person-look';
import {
  faceBaseCount,
  hairAssetCount,
  eyeReferenceCount,
  outfitAssetCount,
  earAssetCount,
  referenceHeadCount,
  safeCharacterOutfitAsset,
} from './character-reference';
import { NativeReader, nativeFloat, quoted, utf8Bytes } from './native-text';
import { f32 as f } from './numeric';
import type { Rgb } from './building-catalog';
export interface CharacterPreset {
  name: string;
  race: Race;
  calling: Calling;
  seed: number;
  look: Appearance;
}
export const maxPresetBytes = 8192;
const colors = ['skin', 'skinShade', 'hair', 'hairShade', 'eyes', 'cloth', 'clothShade', 'trim'] as const;
const details = [
  'freckles',
  'scar',
  'earring',
  'old',
  'eyepatch',
  'warpaint',
  'tippedHair',
  'comely',
  'pointedEars',
  'slitPupils',
] as const;
const ranges: Partial<Record<keyof Appearance, readonly [number, number]>> = {
  faceWidth: [-0.35, 1.35],
  jaw: [-0.2, 1.2],
  eyeSize: [0.25, 2.5],
  jawWidth: [0.65, 1.35],
  chinLength: [0.65, 1.5],
  eyeGap: [6, 11],
  browWeight: [0.5, 4],
  mouthWidth: [3, 10],
  bodyHeight: [0.75, 1.25],
  bodyWidth: [0.75, 1.25],
  irisSize: [0.5, 1.4],
  eyeTilt: [-0.4, 0.4],
  cheekFullness: [0, 1],
  lipFullness: [0.75, 1.25],
  eyeWidth: [0.4, 1.8],
  eyeHeight: [0.4, 1.8],
  eyeLevel: [-0.4, 0.4],
  lidDrop: [-0.4, 0.6],
  noseScale: [0.6, 1.6],
  earScale: [0.7, 1.3],
  equipmentScale: [0, 1.25],
  earHeight: [-0.5, 0.5],
  scalpWidth: [0.88, 1.12],
  scalpHeight: [0.88, 1.12],
  foreheadShift: [-0.2, 0.2],
  templeWidth: [0.94, 1.06],
  hairLength: [0.8, 1.2],
  sideLockGap: [-0.2, 0.4],
  earTilt: [-0.25, 0.25],
  scalpBlend: [0, 1],
  jawBlend: [0, 1],
  pupilHeight: [0.5, 2],
  pupilY: [-0.6, 0.6],
  browWidth: [0.5, 1.8],
  browSpacing: [0.7, 1.4],
  browHeight: [-0.7, 0.7],
  browTilt: [-0.6, 0.6],
  browCurve: [-1, 1],
  faceBlend: [0, 1],
  eyeOpenness: [0.1, 1.4],
  eyeRoundness: [0, 1],
  eyeStroke: [0.25, 2],
  mouthCurve: [-1, 1],
};
const enumRanges: Partial<Record<keyof Appearance, number>> = {
  hairStyle: HairStyle.Straight,
  headwear: Headwear.WideBrim,
  nose: Nose.Hooked,
  whiskers: Whiskers.LongBeard,
  eyeStyle: EyeStyle.Reflective,
  faceShape: FaceShape.Angular,
  mouthStyle: MouthStyle.Small,
  fringeStyle: FringeStyle.Textured,
  hairFinish: HairFinish.Halftone,
  bodyType: BodyType.Female,
  faceAsset: faceBaseCount - 1,
  hairAsset: hairAssetCount - 1,
  eyeReference: eyeReferenceCount - 1,
  outfitAsset: outfitAssetCount - 1,
  earAsset: earAssetCount - 1,
  scalpAsset: faceBaseCount - 1,
  portraitEyeKind: PortraitEyeKind.Open,
  portraitEyeForm: PortraitEyeForm.Reference,
  browReference: eyeReferenceCount - 1,
};
const integer = (value: number, high: number) => Number.isInteger(value) && value >= 0 && value <= high;
export const characterPreset = (p: Person): CharacterPreset => ({
  name: p.name,
  race: p.race,
  calling: p.calling,
  seed: p.look,
  look: appearanceOf(p),
});
export function validCharacter(p: CharacterPreset): boolean {
  if (
    !p.name ||
    utf8Bytes(p.name) > 96 ||
    !Array.from(p.name).some((c) => c.charCodeAt(0) > 32) ||
    /[\u0000-\u001f\u007f]/u.test(p.name) ||
    !integer(p.race, 2) ||
    !integer(p.calling, Calling.Bard) ||
    !integer(p.seed, 4294967295)
  )
    return false;
  const a = p.look;
  if (!integer(a.seed, 4294967295)) return false;
  for (const [key, bounds] of Object.entries(ranges)) {
    const value = a[key as keyof Appearance];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < f(bounds![0]) ||
      value > f(bounds![1])
    )
      return false;
  }
  for (const [key, high] of Object.entries(enumRanges)) {
    const value = a[key as keyof Appearance];
    if (typeof value !== 'number' || !integer(value, high!)) return false;
  }
  for (const key of ['hairCap', 'hairFringe', 'hairBack', 'hairTied'] as const)
    if (a[key] !== 255 && !integer(a[key], hairAssetCount - 1)) return false;
  for (const key of ['scalpTarget', 'jawTarget'] as const)
    if (a[key] !== 255 && !integer(a[key], faceBaseCount - 1)) return false;
  for (const key of [...colors, 'hairEnd'] as const) {
    const value = a[key];
    if (!value || !integer(value.r, 255) || !integer(value.g, 255) || !integer(value.b, 255)) return false;
  }
  return [...details, 'eyeOutline', 'upperLid', 'browVisible'].every(
    (key) => typeof a[key as keyof Appearance] === 'boolean',
  );
}
export function applyCharacter(person: Person, preset: CharacterPreset): boolean {
  if (!validCharacter(preset)) return false;
  person.name = preset.name;
  person.race = preset.race;
  person.calling = preset.calling;
  person.look = preset.seed;
  person.customLook = structuredClone(preset.look);
  person.customLook.outfitAsset = safeCharacterOutfitAsset(preset.look.outfitAsset);
  person.lookRevision++;
  return true;
}
export function refreshShades(a: Appearance): void {
  a.skinShade = mixColor(scaleColor(a.skin, f(0.78)), rgb(120, 60, 70), f(0.12));
  a.hairShade = scaleColor(a.hair, f(0.66));
  a.clothShade = scaleColor(a.cloth, f(0.68));
}
export function encodeCharacter(p: CharacterPreset): string {
  const a = p.look,
    outfit = a.outfitAsset < outfitAssetCount ? safeCharacterOutfitAsset(a.outfitAsset) : a.outfitAsset;
  const row = (name: string, ...values: (number | boolean)[]) =>
    name +
    ' ' +
    values
      .map((v) => (typeof v === 'boolean' ? Number(v) : Number.isInteger(v) ? v : nativeFloat(v)))
      .join(' ');
  return (
    [
      'hearthold-character 9',
      'name ' + quoted(p.name),
      row('identity', p.race, p.calling, p.seed, a.seed),
      row('colors', ...colors.flatMap((key) => [a[key].r, a[key].g, a[key].b])),
      row('styles', a.hairStyle, a.headwear, a.nose, a.whiskers, a.eyeStyle),
      row('face', a.faceWidth, a.jaw, a.eyeSize, a.eyeGap, a.browWeight, a.mouthWidth),
      row('body', a.bodyHeight, a.bodyWidth),
      row('body-type', a.bodyType),
      row('jaw', a.jawWidth, a.chinLength),
      row(
        'features',
        a.faceShape,
        a.mouthStyle,
        a.fringeStyle,
        a.hairFinish,
        a.irisSize,
        a.eyeTilt,
        a.cheekFullness,
        a.lipFullness,
      ),
      row('hair-end', a.hairEnd.r, a.hairEnd.g, a.hairEnd.b),
      row(
        'portrait',
        a.eyeWidth,
        a.eyeHeight,
        a.eyeLevel,
        a.lidDrop,
        a.noseScale,
        a.earScale,
        a.equipmentScale,
      ),
      row('assets', a.faceAsset, a.hairAsset, a.eyeReference, outfit),
      row('ears', a.earAsset, a.earHeight),
      row('cranium', a.scalpAsset, a.scalpWidth, a.scalpHeight, a.foreheadShift, a.templeWidth),
      row('hair-parts', a.hairCap, a.hairFringe, a.hairBack, a.hairTied),
      row('attachments', a.hairLength, a.sideLockGap, a.earTilt),
      row('face-morph', a.scalpTarget, a.scalpBlend, a.jawTarget, a.jawBlend),
      row(
        'eye-system',
        a.portraitEyeKind,
        a.portraitEyeForm,
        a.eyeOutline,
        a.upperLid,
        a.browVisible,
        a.browReference,
        a.pupilHeight,
        a.pupilY,
      ),
      row('brows', a.browWidth, a.browSpacing, a.browHeight, a.browTilt, a.browCurve),
      row('shape', a.faceBlend, a.eyeOpenness, a.eyeRoundness, a.eyeStroke, a.mouthCurve),
      row('details', ...details.map((key) => a[key])),
    ].join('\n') + '\n'
  );
}
export function decodeCharacter(text: string): CharacterPreset {
  const error = 'Invalid character preset (expected version 1 through 9).';
  if (utf8Bytes(text) > maxPresetBytes) throw new Error('Character preset exceeds 8 KiB.');
  const input = new NativeReader(text, error);
  const floats = (name: string, keys: readonly (keyof Appearance)[]) => {
    input.key(name);
    for (const key of keys) (a[key] as number) = input.float();
  };
  const color = (): Rgb => rgb(input.integer(0, 255), input.integer(0, 255), input.integer(0, 255));
  input.key('hearthold-character');
  const version = input.integer(1, 9);
  input.key('name');
  const name = input.token();
  input.key('identity');
  const race = input.integer(0, version >= 6 ? 2 : 3),
    calling = input.integer(0, Calling.Bard),
    seed = input.integer(0, 4294967295),
    faceSeed = input.integer(0, 4294967295),
    a = defaultAppearance();
  a.seed = faceSeed;
  input.key('colors');
  for (const key of colors) a[key] = color();
  input.key('styles');
  a.hairStyle = input.integer(0, HairStyle.Straight);
  a.headwear = input.integer(0, 7);
  a.nose = input.integer(0, 3);
  a.whiskers = input.integer(0, 4);
  a.eyeStyle = input.integer(0, EyeStyle.Reflective);
  floats('face', ['faceWidth', 'jaw', 'eyeSize', 'eyeGap', 'browWeight', 'mouthWidth']);
  floats('body', ['bodyHeight', 'bodyWidth']);
  if (version >= 5) {
    input.key('body-type');
    a.bodyType = input.integer(0, BodyType.Female);
  }
  if (version >= 2) floats('jaw', ['jawWidth', 'chinLength']);
  a.hairEnd = { ...a.hair };
  if (version >= 3) {
    input.key('features');
    a.faceShape = input.integer(0, 3);
    a.mouthStyle = input.integer(0, 3);
    a.fringeStyle = input.integer(0, 4);
    a.hairFinish = input.integer(0, 3);
    a.irisSize = input.float();
    a.eyeTilt = input.float();
    a.cheekFullness = input.float();
    a.lipFullness = input.float();
    input.key('hair-end');
    a.hairEnd = color();
  }
  if (version >= 4)
    floats('portrait', [
      'eyeWidth',
      'eyeHeight',
      'eyeLevel',
      'lidDrop',
      'noseScale',
      'earScale',
      'equipmentScale',
    ]);
  if (version >= 6) {
    input.key('assets');
    const face = input.integer(
        0,
        (version >= 9 ? faceBaseCount : version === 8 ? 4 : referenceHeadCount) - 1,
      ),
      hair = input.integer(0, (version >= 9 ? hairAssetCount : 20) - 1),
      eye = input.integer(0, (version >= 9 ? eyeReferenceCount : referenceHeadCount) - 1),
      outfit = input.integer(0, outfitAssetCount - 1);
    let ear = face;
    if (version >= 7) {
      input.key('ears');
      ear = input.integer(0, (version >= 9 ? earAssetCount : referenceHeadCount) - 1);
      a.earHeight = input.float();
    }
    a.earAsset = ear;
    if (version >= 8) {
      input.key('cranium');
      a.scalpAsset = input.integer(0, (version >= 9 ? faceBaseCount : 4) - 1);
      a.scalpWidth = input.float();
      a.scalpHeight = input.float();
      a.foreheadShift = input.float();
      a.templeWidth = input.float();
      input.key('hair-parts');
      for (const key of ['hairCap', 'hairFringe', 'hairBack', 'hairTied'] as const) {
        const value = input.integer(0, 255);
        if (value !== 255 && value >= (version >= 9 ? hairAssetCount : 20)) throw new Error(error);
        a[key] = value;
      }
      floats('attachments', ['hairLength', 'sideLockGap', 'earTilt']);
    }
    if (version >= 9) {
      input.key('face-morph');
      const target = () => {
        const value = input.integer(0, 255);
        if (value !== 255 && value >= faceBaseCount) throw new Error(error);
        return value;
      };
      a.scalpTarget = target();
      a.scalpBlend = input.float();
      a.jawTarget = target();
      a.jawBlend = input.float();
      input.key('eye-system');
      a.portraitEyeKind = input.integer(0, 1);
      a.portraitEyeForm = input.integer(0, 3);
      a.eyeOutline = !!input.integer(0, 1);
      a.upperLid = !!input.integer(0, 1);
      a.browVisible = !!input.integer(0, 1);
      a.browReference = input.integer(0, eyeReferenceCount - 1);
      a.pupilHeight = input.float();
      a.pupilY = input.float();
      floats('brows', ['browWidth', 'browSpacing', 'browHeight', 'browTilt', 'browCurve']);
    }
    floats('shape', ['faceBlend', 'eyeOpenness', 'eyeRoundness', 'eyeStroke', 'mouthCurve']);
    a.faceAsset = face;
    a.hairAsset = hair;
    a.eyeReference = eye;
    a.outfitAsset = outfit;
  } else {
    const legacyHair = [2, 0, 1, 6, 16, 11, 3, 19, 8, 9, 12];
    a.faceAsset = 0;
    a.hairAsset = legacyHair[a.hairStyle];
    a.eyeReference = a.eyeStyle === EyeStyle.Relaxed || a.eyeStyle === EyeStyle.Hooded ? 4 : 0;
    a.outfitAsset = calling;
    a.headwear = Headwear.None;
    a.whiskers = Whiskers.None;
  }
  if (version < 9) {
    a.portraitEyeKind = PortraitEyeKind.Open;
    a.portraitEyeForm = PortraitEyeForm.Reference;
    a.eyeOutline = a.upperLid = a.browVisible = true;
    a.browReference = a.eyeReference;
    a.pupilHeight = 1;
    a.pupilY = f(0.02);
    if (version === 8) {
      const faces = [0, 22, 24, 21];
      a.faceAsset = faces[a.faceAsset];
      a.scalpAsset = faces[a.scalpAsset === 1 ? 0 : a.scalpAsset];
      const migrate = (id: number) => (id < 19 ? id + 20 : id);
      a.hairAsset = migrate(a.hairAsset);
      a.hairCap = migrate(a.hairCap);
      a.hairFringe = migrate(a.hairFringe);
      a.hairBack = migrate(a.hairBack);
      a.hairTied = migrate(a.hairTied);
    } else a.scalpAsset = a.faceAsset;
  }
  input.key('details');
  for (const key of details) a[key] = !!input.integer(0, 1);
  input.end();
  const preset = { name, race: version >= 6 ? race : Race.Human, calling, seed, look: a };
  if (!validCharacter(preset)) throw new Error(error);
  a.outfitAsset = safeCharacterOutfitAsset(a.outfitAsset);
  return preset;
}
