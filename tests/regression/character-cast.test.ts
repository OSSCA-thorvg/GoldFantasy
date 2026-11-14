import { describe, expect, it } from 'vitest';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { appearanceOf, Mood } from '../../packages/engine/src/person-look';
import { BodyType, Whiskers } from '../../packages/engine/src/person-appearance';
import { characterPreset, validCharacter } from '../../packages/engine/src/character-preset';
import {
  callingOutfit,
  castMember,
  founderCast,
  likenessOf,
  residentCast,
} from '../../packages/engine/src/character-cast';
import { HairCut } from '../../packages/engine/src/likeness';
import { foundingPeople } from '../../packages/engine/src/ymir-born';
import { PersonParts, personSprite, stridePose } from '../../packages/native-renderer/src/world-sprites';
import { personPortrait } from '../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../packages/native-renderer/src/portrait-background';
import { hairForms } from '../../packages/native-renderer/src/likeness-hair';
import { expressionOf, poseFace } from '../../packages/native-renderer/src/likeness-head';
import { serializePaint } from '../../packages/native-renderer/src/paint';

const resident = (seed: number, calling = Calling.Settler) =>
  new Person(1, 'Rowan', Role.Resident, calling, Race.Human, seed, point());
const callings = [
  Calling.Settler,
  Calling.Traveller,
  Calling.Warrior,
  Calling.Ranger,
  Calling.Mage,
  Calling.Cleric,
  Calling.Bard,
];
const fills = (color: { r: number; g: number; b: number }) => `[${color.r},${color.g},${color.b},255]`;
const portraitOf = (person: Person, mood = Mood.Content) =>
  JSON.stringify(serializePaint(personPortrait(person, mood, 96, 120, portraitBackdrop())));
const figureOf = (person: Person) => JSON.stringify(serializePaint(personSprite(person, new PersonParts())));

describe('curated resident cast', () => {
  it('holds whole faces: every cut is drawn and beards grow only on men', () => {
    const cuts = new Set<HairCut>();
    for (const member of residentCast) {
      cuts.add(member.cut);
      const hair = hairForms(member.cut);
      if (member.cut !== HairCut.Bald) expect(hair.front.length + hair.back.length).toBeGreaterThan(0);
      if (member.whiskers !== Whiskers.None) expect(member.body).toBe(BodyType.Male);
    }
    expect(cuts.size).toBeGreaterThan(20);
    expect(residentCast.filter((m) => m.body === BodyType.Female).length).toBe(residentCast.length / 2);
  });
  it('gives every seed one stable member and reaches the whole cast', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 6000; seed++) {
      const member = castMember(seed);
      expect(castMember(seed)).toBe(member);
      expect(likenessOf(resident(seed))).toBe(member);
      seen.add(residentCast.indexOf(member));
    }
    expect(seen.size).toBe(residentCast.length);
  });
  it('keeps the legacy head a valid preset whose body matches the likeness', () => {
    for (let seed = 0; seed < 400; seed++) {
      const person = resident(seed);
      expect(validCharacter(characterPreset(person))).toBe(true);
      expect(appearanceOf(person).bodyType).toBe(likenessOf(person).body);
    }
  });
});

describe('who a person is drawn as', () => {
  it('draws the two founders from their own designs, each wearing a leaf of their own wood', () => {
    foundingPeople.forEach((founder, i) => {
      const person = resident(9 + i);
      person.name = founder.name;
      person.past = founder.past;
      const look = likenessOf(person);
      expect(look).toBe(founderCast[i]);
      expect(look.body).toBe(founder.bodyType);
      expect(look.leaf).toBe(true);
      expect(portraitOf(person)).toContain('[196,156,98,255]');
    });
    expect(founderCast[0].hair).not.toEqual(founderCast[1].hair);
  });
  it('reads a look saved by the old studio through to skin, hair and cut', () => {
    const person = resident(4242);
    person.customLook = appearanceOf(person);
    person.customLook.skin = { r: 200, g: 150, b: 120 };
    person.customLook.hair = { r: 30, g: 60, b: 90 };
    person.customLook.hairAsset = 16;
    person.customLook.whiskers = Whiskers.Beard;
    const look = likenessOf(person);
    expect(look.skin).toEqual({ r: 200, g: 150, b: 120 });
    expect(look.cut).toBe(HairCut.HighBun);
    expect(look.whiskers).toBe(Whiskers.Beard);
    expect(portraitOf(person)).toContain(fills(look.hair));
  });
});

describe('one design on portrait and street figure', () => {
  it('paints the same skin, hair and calling cloth on both, following a changed calling', () => {
    for (const seed of [3, 77, 4242, 90210]) {
      const person = resident(seed),
        look = likenessOf(person);
      for (const calling of callings) {
        person.calling = calling;
        const cloth = fills(callingOutfit(calling, person.look).cloth),
          portrait = portraitOf(person),
          figure = figureOf(person);
        for (const tone of [
          cloth,
          fills(look.skin),
          ...(look.cut === HairCut.Bald ? [] : [fills(look.hair)]),
        ]) {
          expect(portrait).toContain(tone);
          expect(figure).toContain(tone);
        }
      }
    }
    const cloths = callings.map((calling) => fills(callingOutfit(calling, 7).cloth));
    expect(new Set(cloths).size).toBe(callings.length);
  });
  it('shows an equipped helm on both', () => {
    const person = resident(4242, Calling.Warrior),
      steel = '[146,154,160,255]';
    expect(portraitOf(person)).not.toContain(steel);
    person.level = 3;
    person.inventory[0] = { item: 'helmet', quantity: 1 };
    person.equipment.head = 1;
    expect(portraitOf(person)).toContain(steel);
    expect(figureOf(person)).toContain(steel);
  });
});

describe('a living face', () => {
  it('wears the mood: shut eyes asleep, drawn brows in a fight', () => {
    const look = likenessOf(resident(4242));
    expect(expressionOf(look, Mood.Asleep).lids).toBe(0);
    expect(expressionOf(look, Mood.Fierce)).toMatchObject({ browShown: true, brow: 1 });
    expect(expressionOf(look, Mood.Stressed).brow).toBeLessThan(0);
    const person = resident(4242);
    expect(portraitOf(person, Mood.Fierce)).not.toBe(portraitOf(person, Mood.Content));
  });
  it('blinks by closing the eyes on their own line and redraws the brows only when they change', () => {
    const parts = new PersonParts();
    personSprite(resident(4242), parts);
    const face = parts.face!,
      look = parts.look!,
      rest = expressionOf(look, Mood.Content);
    poseFace(face, rest, 1);
    const open = face.eyes.matrix[4],
      drawn = face.brows[0].pathVersion;
    poseFace(face, rest, 0);
    expect(face.eyes.matrix[4]).toBeLessThan(open * 0.2);
    expect(face.brows[0].pathVersion).toBe(drawn);
    poseFace(face, expressionOf(look, Mood.Fierce), 1);
    expect(face.brows[0].pathVersion).toBeGreaterThan(drawn);
  });
});

describe('walk cycle', () => {
  it('swings each arm against the leg on its own side and lifts only the travelling foot', () => {
    const parts = new PersonParts();
    personSprite(resident(4242), parts);
    stridePose(parts, Math.PI / 2, true);
    const footForward = parts.feet[0]!.matrix[2],
      armTurn = parts.arms[0].turn.upper;
    expect(footForward).toBeGreaterThan(0);
    // A positive turn swings this arm back while its foot is forward.
    expect(armTurn).toBeGreaterThan(0);
    stridePose(parts, 0, true);
    expect(parts.feet[0]!.matrix[5]).toBeLessThan(0);
    expect(parts.feet[1]!.matrix[5]).toBeCloseTo(0);
    stridePose(parts, 0, false);
    expect(parts.feet[0]!.matrix[5]).toBeCloseTo(0);
  });
});
