import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Activity, Calling, Person, Race, Role, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import {
  offeringKeys,
  offeringOutcome,
  offeringProfile,
  offeringGradeOf,
  offeringScore,
  gradeOfScore,
  offeringAcceptedText,
  OfferingGrade,
  refusalChances,
  offeringRefused,
  refusalWord,
} from '../../packages/engine/src/prayer-offering';
import { altarCap, altarBaseCap, altarCapReason, altarCapLine } from '../../packages/engine/src/altar-cap';
import { riteTimeline } from '../../packages/native-renderer/src/offering-rite';
import { riteCues, riteEnding } from '../../apps/web/src/native/offering-rite-sound';
import { offeringPhrases } from '../../packages/localization/src/korean/offering';
import { korean } from '../../packages/localization/src/korean';
import { hasHangul } from '../../packages/localization/src/index';
import { Cue } from '../../packages/native-audio/src/sound-types';
import { point } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { sharpAnchor } from '../../packages/engine/src/road-network';

let base: Town;
beforeAll(() => {
  const world = WorldMap.generate(5, 32, 32);
  world.ymir = world.fire = null;
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 32; ++y)
    for (let x = 0; x < 32; ++x)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(28, 28), discovered: false }];
  world.reveal(16, 16, 100);
  base = new Town(world, 32, false);
  base.placed = [
    new Building(0, Structure.Camp, point(10, 10), 0, 0),
    new Building(1, Structure.Shrine, point(14, 10), 0, 0),
  ];
  base.nextId = 2;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(100, 100, 100, 100, 100, 100, 0, 0, 100));
  const p = new Person(0, 'Worshipper', Role.Resident, Calling.Settler, Race.Human, 5, point(11, 12));
  p.home = p.village = 0;
  p.food = p.hydration = p.health = p.rest = 1;
  p.autoMode = false;
  base.folk = [p];
  base.nextPerson = 1;
  base.wildlifeDay = base.days;
  base.editHour(12);
  base.tick(0);
});
const fixture = () => copyNative(base);
function offering(): Resources {
  return new Resources(9, 0, 6, 8, 0, 7, 0, 0, 10);
}
function fillBeds(town: Town, leave = 0): void {
  while (town.population() < town.housing() - leave) {
    const p = copyNative(town.people()[0]);
    p.id = town.nextPerson++;
    town.folk.push(p);
  }
}

describe('offerings shape an unarmed resident', () => {
  it('does not replace a resident road assignment when a new resident is created', () => {
    const town = fixture(),
      p = town.people()[0];
    const path = [sharpAnchor(point(10, 8.8)), sharpAnchor(point(10, 4))];
    expect(town.buildRoad(path), town.canBuildRoad(path).reason).toBe(true);
    expect(town.orderRoadwork([p.id], town.roads().roads()[0].id)).toBe(true);
    town.advance(0.5);
    const worker = copyNative(p),
      clock = town.clock();
    expect(town.summonFromOffering(1, offering())).not.toBeNull();
    expect(p).toEqual(worker);
    expect(town.clock()).toBe(clock);
    expect(p.task).toBe(Activity.Roadwork);
  });
  it('pays all five configured resources once and preserves existing residents and simulation time', () => {
    const town = fixture();
    town.depth = [3];
    fillBeds(town, 1);
    const before = town.stock().clone(),
      gift = offering(),
      existing = encodeTown(town),
      worker = copyNative(town.people()[0]),
      clock = town.clock();
    expect(town.altarOfferingReason(1, gift)).toBe('');
    const born = town.summonFromOffering(1, gift)!;
    expect(born).not.toBeNull();
    expect(town.population()).toBe(town.housing());
    for (const key of offeringKeys) expect(town.stock()[key]).toBe(before[key] - gift[key]);
    expect(town.people()[0]).toEqual(worker);
    expect(town.clock()).toBe(clock);
    expect(born.inventory.every((item) => item === null)).toBe(true);
    expect(Object.values(born.equipment).every((slot) => slot === -1)).toBe(true);
    expect(born.purse).toBe(0);
    expect(born.home).toBe(0);
    expect(town.summonFromOffering(1, gift)).toBeNull(); // The only free bed was claimed atomically.
    for (const key of offeringKeys) expect(town.stock()[key]).toBe(before[key] - gift[key]);
    expect(encodeTown(town)).not.toBe(existing);
  });
  it('uses exactly the advertised level range and class probabilities without creating weapons', () => {
    const town = fixture(),
      gift = offering(),
      profile = offeringProfile(gift);
    vi.spyOn(town, 'roll').mockReturnValue(0);
    const born = town.summonFromOffering(1, gift)!;
    expect(born.calling).toBe(Calling.Warrior);
    expect(born.level).toBe(profile.levelMin);
    expect(born.trained).toBe(true);
    expect(born.attackMultiplier()).toBeCloseTo(1.3 * (1 + Person.attackPerLevel * (profile.levelMin - 1)));
    expect(born.vitalityMultiplier()).toBeCloseTo(profile.vitalityMin);
    expect(born.inventory.every((item) => item === null)).toBe(true);
  });
  for (const invalid of [0, -1, 0.5, NaN, Infinity, 10000])
    it(`rejects invalid or empty amounts (${invalid}) without payment or RNG changes`, () => {
      const town = fixture(),
        gift = new Resources();
      gift.bones = invalid;
      const before = encodeTown(town);
      expect(town.altarOfferingReason(1, gift)).not.toBe('');
      expect(town.summonFromOffering(1, gift)).toBeNull();
      expect(encodeTown(town)).toBe(before);
    });
  it('rejects insufficient stock, forbidden materials, foreign altars and missing housing', () => {
    for (const change of [
      (t: Town, gift: Resources) => {
        t.stock().bones = gift.bones - 1;
      },
      (_t: Town, gift: Resources) => {
        gift.wood = 1;
      },
      (t: Town) => {
        t.building(1)!.faction = 7;
      },
      (t: Town) => {
        fillBeds(t);
      },
    ]) {
      const town = fixture(),
        gift = offering();
      change(town, gift);
      const before = encodeTown(town);
      expect(town.summonFromOffering(1, gift)).toBeNull();
      expect(encodeTown(town)).toBe(before);
    }
  });
  it('lets the same total favor different classes and bounds expensive offerings', () => {
    const bone = new Resources(),
      water = new Resources(),
      gold = new Resources();
    bone.bones = water.water = gold.gold = 30;
    const chance = (gift: Resources, calling: Calling) =>
      offeringProfile(gift).classes.find((row) => row.calling === calling)!.chance;
    expect(chance(bone, Calling.Warrior)).toBeGreaterThan(chance(water, Calling.Warrior));
    expect(chance(water, Calling.Cleric)).toBeGreaterThan(chance(bone, Calling.Cleric));
    expect(chance(gold, Calling.Mage)).toBeGreaterThan(chance(bone, Calling.Mage));
    expect(offeringProfile(new Resources(0, 0, 0, 30)).specialistChance).toBeGreaterThan(
      offeringProfile(new Resources(0, 0, 0, 4)).specialistChance,
    );
    const max = new Resources(9999, 0, 9999, 9999, 0, 9999, 0, 0, 9999),
      p = offeringProfile(max);
    expect(p.levelMax).toBeLessThanOrEqual(8);
    expect(p.specialistChance).toBeLessThanOrEqual(0.85);
    expect(p.classes.reduce((sum, c) => sum + c.chance, 0)).toBeCloseTo(p.specialistChance);
    expect(offeringOutcome(max, () => 0.999999).calling).toBe(Calling.Settler);
    expect(offeringOutcome(max, () => 0.999999).level).toBe(p.levelMax);
  });
  it('round trips bones and the real resident result without replaying an arrival', () => {
    const town = fixture(),
      born = town.summonFromOffering(1, offering())!;
    town.people()[0].inventory[0] = { item: 'bones', quantity: 3 };
    town.people()[0].carriedProduct = Product.Bones;
    town.people()[0].carrying = 2;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true))!;
    expect(loaded.stock().bones).toBe(town.stock().bones);
    expect(loaded.person(born.id)!.calling).toBe(born.calling);
    expect(loaded.person(born.id)!.level).toBe(born.level);
    expect(loaded.people()[0].inventory[0]).toEqual({ item: 'bones', quantity: 3 });
    expect(loaded.people()[0].carriedProduct).toBe(Product.Bones);
    loaded.advance(0.1);
    expect(loaded.population()).toBe(2);
  });
});

describe('bones are stored spoils', () => {
  it('awards bones once from an actual hunt, including food carried by a hungry hunter', () => {
    const town = fixture(),
      hunter = town.people()[0],
      before = town.stock().bones,
      animal = new Monster(99, -1, point(12, 12));
    animal.animal = AnimalKind.Pig;
    animal.health = 0;
    animal.provokedBy = hunter.id;
    hunter.hunting = true;
    hunter.foe = animal.id;
    hunter.food = 0.1;
    town.animals.push(animal);
    town.stirWildlife(0.1);
    expect(town.stock().bones).toBeGreaterThan(before);
    const after = town.stock().bones;
    town.stirWildlife(0.1);
    expect(town.stock().bones).toBe(after);
    expect(hunter.food).toBe(1);
  });
  it('awards bones on a lethal monster strike once, without touching food cargo', () => {
    const town = fixture(),
      p = town.people()[0],
      before = town.stock().bones,
      monster = new Monster(100, 0, point(12, 12));
    monster.health = 0.001;
    town.beasts.push(monster);
    town.strike(p, monster);
    expect(monster.health).toBeLessThanOrEqual(0);
    expect(town.stock().bones).toBe(before + 2);
    town.strike(p, monster);
    expect(town.stock().bones).toBe(before + 2);
  });
  it('includes bones in capacity and preserves stock when storage shrinks', () => {
    const town = fixture(),
      limit = town.capacity().bones;
    expect(limit).toBeGreaterThan(0);
    const gain = new Resources();
    gain.bones = limit * 2;
    town.store(gain, 0);
    expect(town.stock().bones).toBe(limit);
    expect(town.receipts().at(-1)!.gain.bones).toBe(limit - 100);
    expect(new Resources(0, 0, 0, 0, 0, 0, 0, 0, 4).clone().bones).toBe(4);
  });
});

const gift = (water = 0, bones = 0, gold = 0, food = 0, stone = 0): Resources => {
  const r = new Resources();
  Object.assign(r, { water, bones, gold, food, stone });
  return r;
};

describe('offering grades', () => {
  it('cut the score at 3, 5 and 7', () => {
    expect([2.99, 3, 4.99, 5, 6.99, 7, 10.5].map(gradeOfScore)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
  it('read a bare, a middling, a rich and a kingly gift', () => {
    expect(offeringGradeOf(gift(0, 0, 0, 4)).name).toBe('Humble');
    expect(offeringGradeOf(gift(4, 0, 4, 8, 4)).name).toBe('Worthy');
    expect(offeringGradeOf(gift(8, 12, 10, 16, 6)).name).toBe('Bountiful');
    expect(offeringGradeOf(gift(60, 60, 60, 60, 60)).name).toBe('Kingly');
  });
  it('never change the profile, and only rise as gifts are added', () => {
    const base = gift(5, 5, 5, 5, 5),
      before = JSON.stringify(offeringProfile(base));
    offeringGradeOf(base, gift(60, 60, 60, 60, 60));
    expect(JSON.stringify(offeringProfile(base))).toBe(before);
    let last = -1;
    for (let n = 0; n <= 60; n += 3) {
      const grade = offeringGradeOf(gift(n, n, n, n, n)).grade;
      expect(grade).toBeGreaterThanOrEqual(last);
      last = grade;
    }
  });
  it('name the quickest resource for the next grade, within the stores', () => {
    const humble = offeringGradeOf(gift(0, 0, 0, 4)),
      next = humble.next!;
    expect(next.grade).toBe(OfferingGrade.Worthy);
    const raised = gift(0, 0, 0, 4);
    for (let extra = 1; extra < 9999; ++extra) {
      raised[next.resource] += 1;
      if (offeringGradeOf(raised).grade >= OfferingGrade.Worthy) break;
    }
    expect(offeringGradeOf(raised).grade).toBe(OfferingGrade.Worthy);
    expect(offeringGradeOf(gift(0, 0, 0, 4), gift(0, 0, 0, 4)).next).toBeNull();
    expect(offeringGradeOf(gift(60, 60, 60, 60, 60)).next).toBeNull();
  });
  it('say what was accepted in plain words', () => {
    expect(offeringAcceptedText(OfferingGrade.Humble)).toBe('A humble offering was accepted.');
    expect(offeringAcceptedText(OfferingGrade.Kingly)).toBe('A kingly offering was accepted.');
  });
});

describe('the rite per grade', () => {
  it('is longer and fuller for higher grades', () => {
    const lengths = [0, 1, 2, 3].map((g) => riteTimeline(g, 3, 3).end);
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
    expect(lengths[3] - lengths[0]).toBeGreaterThan(2);
    expect(riteTimeline(3, 5, 3).end).toBeLessThan(11);
  });
  it('asks for a cue at each beat, louder for higher grades, with no bells', () => {
    const keys = ['water', 'gold', 'stone'] as const,
      low = riteCues(riteTimeline(0, 3, 2), keys, 2),
      high = riteCues(riteTimeline(3, 3, 2), keys, 2),
      loudest = (list: ReturnType<typeof riteCues>, cue: Cue) =>
        Math.max(...list.filter((c) => c.cue === cue).map((c) => c.gain));
    expect(low.filter((c) => c.cue === Cue.Coins)).toHaveLength(1);
    expect(low.filter((c) => c.cue === Cue.Click)).toHaveLength(2 + 2);
    expect(loudest(high, Cue.Discover)).toBeGreaterThan(loudest(low, Cue.Discover));
    expect(low.some((c) => c.cue === Cue.Raven)).toBe(false);
    expect(high.some((c) => c.cue === Cue.Raven)).toBe(true);
    expect([...low, ...high].some((c) => c.cue === Cue.Complete || c.cue === Cue.Notice)).toBe(false);
    const tl = riteTimeline(3, 3, 2);
    expect(riteEnding(tl, false).map((c) => c.cue)).toEqual([Cue.Fall, Cue.Sanctuary, Cue.Rally]);
    expect(riteEnding(tl, true).map((c) => c.cue)).toEqual([Cue.Fall, Cue.Click]);
  });
});

describe('refused offerings', () => {
  it('fail by grade: often, sometimes, rarely, never', () => {
    expect(refusalChances).toEqual([0.35, 0.15, 0.05, 0]);
    expect([0, 1, 2, 3].map(refusalWord)).toEqual([
      'Often refused',
      'Sometimes refused',
      'Rarely refused',
      'Never refused',
    ]);
    expect(offeringRefused(0, 0.64)).toBe(false);
    expect(offeringRefused(0, 0.65)).toBe(true);
    expect(offeringRefused(3, 0.999999)).toBe(false);
    expect(offeringRefused(1, 0)).toBe(false);
  });
  it('spend the gifts, send no one and use one roll', () => {
    const town = fixture(),
      before = town.stock().clone(),
      people = town.population(),
      small = gift(0, 0, 0, 4);
    vi.spyOn(town, 'roll').mockReturnValue(0.99);
    const result = town.offerAtAltar(1, small);
    expect(result).toEqual({ born: null, refused: true });
    expect(town.population()).toBe(people);
    expect(town.stock().food).toBe(before.food - 4);
    expect(town.roll).toHaveBeenCalledTimes(1);
  });
  it('lets a kingly gift through whatever the roll', () => {
    const town = fixture();
    vi.spyOn(town, 'roll').mockReturnValue(0.999999);
    expect(town.offerAtAltar(1, gift(60, 60, 60, 60, 60)).born).not.toBeNull();
  });
  it('is deterministic for one seed and saves like any other town', () => {
    const run = () => {
      const town = fixture();
      return town.offerAtAltar(1, gift(0, 0, 0, 4)).refused;
    };
    expect(run()).toBe(run());
    const town = fixture();
    vi.spyOn(town, 'roll').mockReturnValue(0.99);
    town.offerAtAltar(1, gift(0, 0, 0, 4));
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true))!;
    expect(loaded.stock().food).toBe(town.stock().food);
    expect(loaded.population()).toBe(town.population());
  });
});

describe('the altar cap', () => {
  const withDepth = (depth: number[]) => {
    const town = fixture();
    town.depth = depth;
    return town;
  };
  it('starts at four and rises by two a floor and two more for a seal', () => {
    expect(altarBaseCap).toBe(4);
    expect([[], [0], [1], [2], [3]].map((d) => altarCap(withDepth(d)))).toEqual([4, 4, 6, 8, 12]);
  });
  it('refuses at the cap and spends nothing', () => {
    const town = fixture();
    while (town.population() < altarCap(town)) {
      const p = copyNative(town.people()[0]);
      p.id = town.nextPerson++;
      town.folk.push(p);
    }
    fillBeds(town, 1);
    const stock = town.stock().clone(),
      people = town.population(),
      rolls = vi.spyOn(town, 'roll');
    expect(town.altarOfferingReason(1, gift(0, 0, 0, 8))).toBe(altarCapReason);
    expect(town.summonFromOffering(1, gift(0, 0, 0, 8))).toBeNull();
    expect(town.stock()).toEqual(stock);
    expect(town.population()).toBe(people);
    expect(rolls).not.toHaveBeenCalled();
    expect(altarCapReason).toBe('Odin sends no more until another floor beyond a gate is cleared.');
    town.depth = [1];
    fillBeds(town, 1);
    expect(town.altarOfferingReason(1, gift(0, 0, 0, 8))).toBe('');
  });
  it('shows the raise in the reward lines text', () => {
    expect(altarCapLine(6)).toBe('Odin will now send up to 6 residents.');
  });
  it('is read from the saved depth, so a loaded town keeps it', () => {
    const town = withDepth([2]),
      loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true))!;
    expect(altarCap(loaded)).toBe(altarCap(town));
  });
});

describe('the offering words in Korean', () => {
  it('use only KS X 1001 syllables, keep placeholders and cover every runtime line', () => {
    const decoder = new TextDecoder('euc-kr'),
      carried = new Set<string>();
    for (let lead = 0xb0; lead < 0xc9; ++lead)
      for (let trail = 0xa1; trail < 0xff; ++trail)
        carried.add(decoder.decode(new Uint8Array([lead, trail])));
    const used = [...Object.values(offeringPhrases).join('')].filter((c) => /[\uac00-\ud7a3]/.test(c));
    expect(used.filter((c) => !carried.has(c))).toEqual([]);
    const marks = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((hit) => hit[1]).sort();
    for (const [key, value] of Object.entries(offeringPhrases)) expect(marks(value), key).toEqual(marks(key));
    const lines = [
      ...[0, 1, 2, 3].flatMap((g) => [
        offeringAcceptedText(g),
        offeringGradeOf(gift(0, 0, 0, 4)).line,
        refusalWord(g),
      ]),
      ...['Humble', 'Worthy', 'Bountiful', 'Kingly'].map((name) => `${name} offering`),
      ...offeringKeys.flatMap((key) =>
        ['worthy', 'bountiful', 'kingly'].map((g) => `Lay more ${key} to reach a ${g} offering.`),
      ),
      altarCapLine(6),
      altarCapReason,
      'Odin sends up to 6 residents; 2 live here.',
      'Leans toward Warriors.',
      'Odin turned the offering away. The gifts are gone.',
    ];
    for (const line of lines) expect(hasHangul(korean.translate(line)), line).toBe(true);
    for (const g of [1, 2, 3])
      expect(hasHangul(korean.translate(offeringGradeOf(gift(60, 60, 60, 60, 60)).line))).toBe(true);
    for (const line of [
      'A fair gift. It tends to bring a settler with some skill.',
      'A rich gift. It tends to bring a gifted and hardy resident.',
    ])
      expect(hasHangul(korean.translate(line)), line).toBe(true);
  });
});
