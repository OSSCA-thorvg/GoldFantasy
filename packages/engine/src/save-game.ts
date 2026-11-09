// Translated from src/game/save_game.cpp. Browser storage is owned by the host.
import {
  SaveArchive,
  raw,
  record,
  vector,
  optional,
  boolean,
  string,
  u8,
  i32,
  u32,
  u64,
  f32,
  f64,
  digest,
  nativeAppearanceSize,
  nativeClimateSize,
  type Codec,
} from './save-archive';
import { TownState } from './town-state';
import { WorldMap } from './world-map';
import {
  Layer,
  Giant,
  Volcano,
  DungeonKind,
  Region,
  makeTile,
  type Dungeon,
  type River,
} from './world-types';
import { Building, Field } from './town-models';
import { Road, RoadNetwork, type RoadAnchor } from './road-network';
import { Climate, Sky } from './climate';
import { Resources, Structure, isSeat, structureSpec, type Stage } from './building-catalog';
import { ConstructionMaterials } from './construction-materials';
import {
  Person,
  Monster,
  Role,
  Calling,
  Race,
  AnimalKind,
  TreeWorkKind,
  type Expedition,
  type Hit,
  type TreeWorkEvent,
} from './person';
import { CampEconomy, Ledger } from './camp-economy';
import { point } from './geometry';
import { defaultAppearance } from './person-look';
export interface SaveTown extends TownState {
  camp(id?: number): Building | null;
  settlement(id: number): CampEconomy;
  migrateSettlements(): void;
  recount(): void;
}
export const maxSaveBytes = 96 * 1024 * 1024;
const pointCodec = raw('Point', () => point()),
  coordCodec = raw('TileCoord', () => ({ x: 0, y: 0 }));
const resourcesCodec = raw('Resources', () => new Resources()),
  ledgerCodec = raw('CampEconomy::Ledger', () => new Ledger());
const appearanceCodec = raw('Appearance', defaultAppearance),
  climateCodec = raw('Climate', () => new Climate());
const stageCodec = raw<Stage>('Stage', () => ({ kind: Structure.Camp, variant: 0, dx: 0, dy: 0 }));
const tileCodec = raw('Tile', makeTile),
  sightCodec = raw('Sight', () => ({ center: point(), radius: 0 }));
const anchorCodec = raw<RoadAnchor>('RoadAnchor', () => ({ point: point(), in: point(), out: point() }));
const giantCodec = raw('Giant', () => new Giant({ x: 0, y: 0 })),
  volcanoCodec = raw('Volcano', () => new Volcano({ x: 0, y: 0 }));
const hitCodec = raw<Hit>('Hit', () => ({
  serial: 0n,
  from: point(),
  to: point(),
  damage: 0,
  onPerson: false,
  ranged: false,
  at: 0,
  person: -1,
}));
const treeEventCodec = raw<TreeWorkEvent>('TreeWorkEvent', () => ({
  serial: 0n,
  kind: TreeWorkKind.Chop,
  person: 0,
  cell: 0,
  index: 0,
  worker: point(),
  at: 0,
}));
const dungeonCodec = record<Dungeon>(
  () => ({ name: '', kind: DungeonKind.Cave, origin: { x: 0, y: 0 }, discovered: false }),
  { name: string, kind: u8, origin: coordCodec, discovered: boolean },
  (v) => {
    if (v.kind >= 5) throw new Error('Invalid dungeon kind');
  },
);
const riverCodec = record((): River => ({ path: [], width: [] }), {
  path: vector(pointCodec),
  width: vector(f32),
});
function worldFields(a: SaveArchive, v: WorldMap): void {
  a.fields(v, { columns: i32, rows: i32, mapSeed: u32, origin: coordCodec });
  if (v.columns < 32 || v.columns > 256 || v.rows < 32 || v.rows > 256)
    throw new Error('Invalid world dimensions');
  v.tiles = a.value(vector(tileCodec), v.tiles);
  for (let i = 0; i < Layer.Count; ++i) {
    if (a.reading) v.layers[i] = new Float32Array(vector(f32).read(a));
    else vector(f32).write(a, v.layers[i]);
  }
  a.fields(v, {
    stream: riverCodec,
    seen: vector(sightCodec),
    sites: vector(dungeonCodec),
    ymir: optional(giantCodec),
    fire: optional(volcanoCodec),
    laidOut: boolean,
  });
  if (v.tiles.length !== v.columns * v.rows || v.stream.path.length !== v.stream.width.length)
    throw new Error('Invalid world data');
  for (const layer of v.layers)
    if (layer.length !== (v.columns * 2 + 1) * (v.rows * 2 + 1)) throw new Error('Invalid world layers');
}
const worldCodec: Codec<WorldMap> = {
  read(a) {
    const v = new WorldMap();
    worldFields(a, v);
    return v;
  },
  write(a, value) {
    if (!(value instanceof WorldMap)) throw new Error('Invalid world data');
    worldFields(a, value);
  },
};
const skyCodec: Codec<Sky> = {
  read(a) {
    const sky = new Sky(0),
      state = sky.snapshot();
    a.fields(state, { climate: climateCodec, timer: f32, state: u32, peak: f32, span: f32, breeze: f32 });
    sky.restore(state);
    return sky;
  },
  write(a, value) {
    if (!(value instanceof Sky)) throw new Error('Invalid sky');
    a.fields(value.snapshot(), {
      climate: climateCodec,
      timer: f32,
      state: u32,
      peak: f32,
      span: f32,
      breeze: f32,
    });
  },
};
const roadCodec = record(() => new Road(0, [], []), {
  id: i32,
  path: vector(anchorCodec),
  line: vector(pointCodec),
  built: f32,
  paved: boolean,
  paving: f32,
  wear: f32,
  constructionStart: f32,
  parent: i32,
  parentAt: f32,
});
const networkCodec = record(() => new RoadNetwork(), { list: vector(roadCodec), nextId: i32 });
const buildingCodec = record(
  () => new Building(0, Structure.Camp, point(), 0, 0),
  {
    id: i32,
    kind: u8,
    center: pointCodec,
    angle: f32,
    variant: u32,
    workers: i32,
    wanted: i32,
    growth: i32,
    version: u32,
    replaced: vector(stageCodec),
    progress: f32,
    workedSeconds: f32,
    attendance: f32,
    earned: i32,
    registered: i32,
    faith: u8,
    owner: i32,
    health: f32,
  },
  (v) => {
    if (v.kind >= Structure.Count) throw new Error('Invalid building kind');
  },
);
const fieldCodec = record(() => new Field(0, []), { id: i32, outline: vector(pointCodec) });
const expeditionCodec = record<Expedition>(() => ({ dungeon: 0, members: [], returnAt: -1 }), {
  dungeon: i32,
  members: vector(i32),
  returnAt: f64,
});
function monsterFields(a: SaveArchive, v: Monster): void {
  a.fields(v, {
    id: i32,
    lair: i32,
    position: pointCodec,
    path: vector(pointCodec),
    health: f32,
    raider: boolean,
    angry: boolean,
    ready: f64,
    home: pointCodec,
    prey: i32,
  });
  if (a.formatVersion >= 4) a.fields(v, { race: optional(u8), insideLair: boolean, provokedBy: i32 });
  if (a.legacyV6MonsterTags) a.fields(v, { animal: optional(u8) });
  if (v.race !== null && v.race >= 3) throw new Error('Invalid creature race');
}
const monsterCodec: Codec<Monster> = {
  read(a) {
    const v = new Monster(0, 0, point());
    monsterFields(a, v);
    return v;
  },
  write(a, value) {
    if (!(value instanceof Monster)) throw new Error('Invalid creature');
    monsterFields(a, value);
  },
};
const wildlifeCodec: Codec<Monster[]> = {
  read(a) {
    const count = u32.read(a);
    if (count > 128) throw new Error('Too many animals');
    return Array.from({ length: count }, () => {
      const animal = monsterCodec.read(a);
      if (!a.legacyV6MonsterTags) a.fields(animal, { animal: optional(u8) });
      if (animal.animal === null || animal.animal >= AnimalKind.Count) throw new Error('Invalid animal kind');
      return animal;
    });
  },
  write(a, animals) {
    if (!Array.isArray(animals)) throw new Error('Invalid wildlife');
    u32.write(a, animals.length);
    if (animals.length > 128) throw new Error('Too many animals');
    for (const animal of animals) {
      if (!(animal instanceof Monster)) throw new Error('Invalid wildlife');
      monsterCodec.write(a, animal);
      a.fields(animal, { animal: optional(u8) });
      if (animal.animal === null || animal.animal >= AnimalKind.Count) throw new Error('Invalid animal kind');
    }
  },
};
function personFields(a: SaveArchive, v: Person): void {
  a.fields(v, {
    id: i32,
    name: string,
    role: u8,
    calling: u8,
    race: u8,
    look: u32,
    position: pointCodec,
    path: vector(pointCodec),
    activity: u8,
    target: i32,
    until: f64,
    inside: boolean,
    ordered: boolean,
    task: u8,
    taskSite: i32,
    food: f32,
    rest: f32,
    stress: f32,
    health: f32,
    home: i32,
    job: i32,
    bed: i32,
    autoMode: boolean,
    ready: f64,
    foe: i32,
    tree: i32,
    carrying: i32,
    carriedProduct: u8,
    aggressive: boolean,
    approachingOrder: boolean,
    goal: pointCodec,
    days: i32,
    loot: i32,
    relaxedAt: f64,
    prayedAt: f64,
    load: f32,
    breaking: f32,
    gear: i32,
    purse: i32,
    worked: f32,
    unpaid: boolean,
    sleptOutside: boolean,
    customLook: optional(appearanceCodec),
    lookRevision: u64,
    entrance: pointCodec,
    threshold: pointCodec,
    doorway: f32,
    faith: u8,
    past: string,
  });
  if (a.formatVersion >= 3) a.fields(v, { level: i32, experience: i32 });
  if (a.formatVersion >= 8) {
    if (a.reading) {
      const flag = u8.read(a);
      if (flag > 1) throw new Error('Invalid rest recovery flag');
      v.recoveringRest = flag !== 0;
    } else boolean.write(a, v.recoveringRest);
  }
  if (
    a.reading &&
    (v.level < 1 ||
      v.level > Person.maximumLevel ||
      v.experience < 0 ||
      (v.level === Person.maximumLevel ? v.experience !== 0 : v.experience >= v.experienceToNextLevel()))
  )
    throw new Error('Invalid character progression');
}
const personCodec: Codec<Person> = {
  read(a) {
    const v = new Person(0, '', Role.Resident, Calling.Settler, Race.Human, 0, point());
    personFields(a, v);
    return v;
  },
  write(a, value) {
    if (!(value instanceof Person)) throw new Error('Invalid character');
    personFields(a, value);
  },
};
const campCodec: Codec<CampEconomy> = {
  read(a) {
    const value = new CampEconomy();
    campFields(a, value);
    return value;
  },
  write(a, value) {
    if (!(value instanceof CampEconomy)) throw new Error('Invalid camp economy');
    campFields(a, value);
  },
};
function campFields(a: SaveArchive, v: CampEconomy): void {
  a.fields(v, {
    camp: i32,
    stock: resourcesCodec,
    renown: f32,
    today: ledgerCodec,
    yesterday: ledgerCodec,
    growingTended: f32,
    growingDays: i32,
  });
  const dry = a.value(u8, v.parched ? 1 : 0);
  a.fields(v, { spoiledDay: i32, arrivalTimer: f64, bardDue: f64 });
  if (a.reading) {
    if (
      dry > 1 ||
      !Number.isFinite(v.renown) ||
      v.renown < 0 ||
      v.renown > 100 ||
      !Number.isFinite(v.arrivalTimer) ||
      !Number.isFinite(v.bardDue) ||
      !Number.isFinite(v.growingTended) ||
      !v.stock.covers(new Resources())
    )
      throw new Error('Invalid camp economy');
    v.parched = dry !== 0;
  }
}
function townFields(a: SaveArchive, v: SaveTown): void {
  const legacy = a.reading ? new CampEconomy() : v.settlement(v.camp()?.id ?? -1);
  a.fields(v, {
    world: worldCodec,
    network: networkCodec,
    placed: vector(buildingCodec),
    farmland: vector(fieldCodec),
    folk: vector(personCodec),
    sky: skyCodec,
  });
  if (a.reading) v.open = new Uint8Array(vector(u8).read(a));
  else vector(u8).write(a, v.open);
  a.fields(v, {
    depth: vector(i32),
    beasts: vector(monsterCodec),
    parties: vector(expeditionCodec),
    nextMonster: i32,
    raidedDay: i32,
    raidCount: i32,
    raidKills: i32,
    raidBounty: i32,
  });
  a.fields(legacy, { renown: f32, today: ledgerCodec, yesterday: ledgerCodec });
  a.fields(v, {
    blows: vector(hitCodec),
    nextBlow: u64,
    timberEvents: vector(treeEventCodec),
    nextTreeEvent: u64,
  });
  a.fields(legacy, {
    growingTended: f32,
    growingDays: i32,
    stock: resourcesCodec,
    parched: boolean,
    spoiledDay: i32,
  });
  a.fields(v, { nextId: i32, nextPerson: i32, time: f64, days: i32 });
  a.fields(legacy, { arrivalTimer: f64, bardDue: f64 });
  a.fields(v, { dice: u32, notices: vector(string, 10000) });
  if (a.formatVersion >= 4) a.fields(v, { giantDay: i32 });
  if (a.formatVersion >= 5) {
    const start = a.cursor;
    let owners = a.reading
      ? []
      : [
          ...v.placed.map((b) => b.village),
          ...v.network.list.map((r) => r.village),
          ...v.farmland.map((field) => field.village),
          ...v.folk.map((p) => p.village),
        ];
    a.fields(v, { provisions: campCodec, villages: vector(campCodec) });
    owners = a.value(vector(i32), owners);
    if (a.formatVersion >= 6) a.fields(v, { animals: wildlifeCodec, wildlifeDay: i32 });
    if (a.formatVersion >= 7) {
      const material = (m: ConstructionMaterials) => {
        a.fields(m, { required: resourcesCodec, delivered: resourcesCodec });
        if (a.reading && (!m.required.covers(new Resources()) || !m.delivered.covers(new Resources())))
          throw new Error('Invalid construction materials');
      };
      for (const building of v.placed) material(building.materials);
      for (const road of v.network.list) material(road.materials);
      for (const person of v.folk) {
        a.fields(person, { supplyTarget: i32 });
        const road = a.value(u8, person.supplyRoad ? 1 : 0);
        if (a.reading) {
          if (road > 1) throw new Error('Invalid construction delivery');
          person.supplyRoad = road !== 0;
        }
      }
    }
    const extent = a.cursor - start,
      stored = a.value(u32, extent);
    if (a.reading) {
      if (
        stored !== extent ||
        owners.length !== v.placed.length + v.network.list.length + v.farmland.length + v.folk.length
      )
        throw new Error('Invalid camp ownership');
      let at = 0;
      for (const b of v.placed) b.village = owners[at++];
      for (const road of v.network.list) road.village = owners[at++];
      for (const field of v.farmland) field.village = owners[at++];
      for (const person of v.folk) person.village = owners[at++];
      const camps = new Set<number>();
      for (const village of v.villages) {
        if (!v.camp(village.camp) || camps.has(village.camp)) throw new Error('Invalid camp stockpile');
        camps.add(village.camp);
      }
      if (v.provisions.camp !== -1 || camps.size !== v.placed.filter((b) => isSeat(b.kind)).length)
        throw new Error('Missing camp stockpile');
      for (const b of v.placed)
        if ((isSeat(b.kind) && b.village !== b.id) || (b.village >= 0 && !camps.has(b.village)))
          throw new Error('Invalid building village');
      for (const road of v.network.list)
        if (road.village >= 0 && !camps.has(road.village)) throw new Error('Invalid road village');
      for (const field of v.farmland)
        if (field.village >= 0 && !camps.has(field.village)) throw new Error('Invalid field village');
      for (const person of v.folk)
        if (person.village >= 0 && !camps.has(person.village)) throw new Error('Invalid character village');
    }
  } else if (a.reading) {
    v.provisions = legacy;
    v.migrateSettlements();
  }
  if (a.reading && a.formatVersion < 7)
    for (const building of v.placed) {
      const cost = structureSpec(building.kind).cost;
      building.materials = new ConstructionMaterials(
        new Resources(cost.gold, cost.wood, cost.stone, cost.food, cost.mana, cost.water),
        new Resources(cost.gold, cost.wood, cost.stone, cost.food, cost.mana, cost.water),
      );
    }
  if (a.reading) {
    if (
      v.open.length !== v.world.sites.length ||
      v.depth.length > v.world.sites.length ||
      !Number.isFinite(v.time)
    )
      throw new Error('Invalid settlement');
    for (const beast of v.beasts)
      if (
        beast.animal !== null ||
        beast.lair < 0 ||
        beast.lair >= v.world.sites.length ||
        !Number.isFinite(beast.health) ||
        (beast.giant() && (beast.raider || v.world.sites[beast.lair].kind !== DungeonKind.GiantHall))
      )
        throw new Error('Invalid creature lair');
    if (v.animals.length > 128) throw new Error('Too many animals');
    for (const animal of v.animals)
      if (
        animal.animal === null ||
        animal.race !== null ||
        animal.lair !== -1 ||
        animal.raider ||
        animal.insideLair ||
        !Number.isFinite(animal.health) ||
        !v.world.inside(animal.position) ||
        v.world.regionAt(animal.position) !== Region.Middle
      )
        throw new Error('Invalid wildlife habitat');
    const obstacles = v.placed.filter((b) => b.kind !== Structure.Torch).map((b) => b.footprint());
    v.grid.rebuild(v.world, v.network, obstacles);
    v.walkRevision = v.changes = 1n;
    v.roadChanges = 1n;
    v.roadOnlyChanges = 0n;
    v.recount();
  }
}
export function encodeTown(town: SaveTown): string {
  const a = new SaveArchive();
  // Keep historical v7 bytes unchanged when no new recovery state is needed.
  a.formatVersion = town.folk.some((p) => p.recoveringRest) ? 8 : 7;
  a.fields(
    {
      version: a.formatVersion,
      endian: 0x01020304,
      appearanceSize: nativeAppearanceSize,
      climateSize: nativeClimateSize,
    },
    { version: u32, endian: u32, appearanceSize: u32, climateSize: u32 },
  );
  townFields(a, town);
  u64.write(a, digest(a.buffer()));
  let text = 'GoldFantasy-save\n';
  const hex = '0123456789abcdef';
  for (const byte of a.buffer()) text += hex[byte >> 4] + hex[byte & 15];
  if (text.length > maxSaveBytes) throw new Error('Save exceeds size limit');
  return text;
}
export function decodeTown<T extends SaveTown>(encoded: string, create: (map: WorldMap) => T): T {
  if (encoded.length > maxSaveBytes) throw new Error('Save exceeds size limit');
  if (!encoded.startsWith('GoldFantasy-save\n')) throw new Error('Not a GoldFantasy save');
  const data = encoded.slice(17);
  if (data.length % 2 || data.length < 40) throw new Error('Invalid save length');
  const bytes = new Uint8Array(data.length / 2);
  const nibble = (c: number) => {
    if (c >= 48 && c <= 57) return c - 48;
    if (c >= 97 && c <= 102) return c - 97 + 10;
    throw new Error('Invalid save encoding');
  };
  for (let i = 0; i < data.length; i += 2)
    bytes[i / 2] = nibble(data.charCodeAt(i)) * 16 + nibble(data.charCodeAt(i + 1));
  const checksum = u64.read(new SaveArchive(true, bytes.subarray(bytes.length - 8))),
    payload = bytes.subarray(0, bytes.length - 8);
  if (digest(payload) !== checksum) throw new Error('Save checksum mismatch');
  const a = new SaveArchive(true, payload),
    version = u32.read(a),
    endian = u32.read(a),
    appearanceSize = u32.read(a);
  let climateSize = 0;
  if (version >= 2 && version <= 8) climateSize = u32.read(a);
  if (
    version < 2 ||
    version > 8 ||
    endian !== 0x01020304 ||
    appearanceSize !== nativeAppearanceSize ||
    climateSize !== nativeClimateSize
  )
    throw new Error('Unsupported save version');
  const read = (legacyV6MonsterTags = false) => {
    const archive = new SaveArchive(true, payload);
    archive.cursor = a.cursor;
    archive.formatVersion = version;
    archive.legacyV6MonsterTags = legacyV6MonsterTags;
    const town = create(new WorldMap());
    townFields(archive, town);
    if (archive.remaining()) throw new Error('Unexpected trailing save data');
    return town;
  };
  try {
    return read();
  } catch (error) {
    // Preserve saves produced by the first exact migration. The corrected native
    // layout is always attempted first; both readers require a valid full archive.
    if (version === 6) {
      try {
        return read(true);
      } catch {
        /* Report the current native layout's error. */
      }
    }
    throw error;
  }
}
