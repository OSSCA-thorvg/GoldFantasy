// Native Town storage and non-simulating constructor. Simulation methods are translated in separate modules.
import { WorldMap } from './world-map';
import { RoadNetwork } from './road-network';
import { WalkGrid } from './walk-paths';
import { Building, Field } from './town-models';
import { Person, Monster, AnimalCall, Expedition, Hit, TreeWorkEvent } from './person';
import { Point } from './geometry';
import { CampEconomy, CampReceipt } from './camp-economy';
import { Resources } from './building-catalog';
import { Sky } from './climate';
import { f32 } from './numeric';
export class TownState {
  static readonly secondsPerDay = 300; static readonly daysPerMonth = 5; static readonly maxRoadLength = 24; static readonly maxBridgeSpan = 7; static readonly roadHalfWidth = f32(.3); static readonly maxFieldAcres = 48; static readonly farmReach = 6; static readonly joinReach = f32(.8); static readonly campReach = 12; static readonly paidWorkSeconds = f32(300 * f32(.12)); static readonly maxRaiders = 16;
  titleAutoplay = false; titleBuilder = -1; titleFoodUntil = -1; titlePlanTimer = 0; titleWeatherTimer = 0; titleAnchors: Point[] = [];
  network = new RoadNetwork(); placed: Building[] = []; farmland: Field[] = []; folk: Person[] = []; grid = new WalkGrid(); sky: Sky;
  open: Uint8Array; depth: number[] = []; beasts: Monster[] = []; animals: Monster[] = []; animalCalls: AnimalCall[] = []; nextAnimalCall = 0n; wildlifeDay = -1;
  parties: Expedition[] = []; nextMonster = 0; giantDay = -1; raidedDay = -1; raidCount = 0; raidKills = 0; raidBounty = 0; blows: Hit[] = []; nextBlow = 0n; timberEvents: TreeWorkEvent[] = []; nextTreeEvent = 0n;
  provisions = new CampEconomy(); villages: CampEconomy[] = []; deliveries: CampReceipt[] = []; nextReceipt = 0n; nextId = 0; nextPerson = 0; time = 0; days = 0; walkRevision = 0n; dice: number; notices: string[] = []; changes = 1n; roadChanges = 1n; roadOnlyChanges = 0n;
  constructor(public world: WorldMap) { this.sky = new Sky(world.seed()); this.dice = (Math.imul(world.seed(), 2246822519) + 7) >>> 0; this.open = new Uint8Array(world.dungeons().length); this.time = TownState.secondsPerDay * .3; }
  map(): WorldMap { return this.world; } roads(): RoadNetwork { return this.network; } walking(): WalkGrid { return this.grid; } buildings(): readonly Building[] { return this.placed; } fields(): readonly Field[] { return this.farmland; } people(): readonly Person[] { return this.folk; }
  building(id: number): Building | null { return this.placed.find(b => b.id === id) ?? null; } person(id: number): Person | null { return this.folk.find(p => p.id === id) ?? null; }
  opened(dungeon: number): boolean { return dungeon >= 0 && dungeon < this.open.length && !!this.open[dungeon]; }
  settlements(): readonly CampEconomy[] { return this.villages; } receipts(): readonly CampReceipt[] { return this.deliveries; } monsters(): readonly Monster[] { return this.beasts; } wildlife(): readonly Monster[] { return this.animals; } wildlifeCalls(): readonly AnimalCall[] { return this.animalCalls; } hits(): readonly Hit[] { return this.blows; } treeEvents(): readonly TreeWorkEvent[] { return this.timberEvents; } expeditions(): readonly Expedition[] { return this.parties; }
  raids(): number { return this.raidCount; } clock(): number { return this.time; } climate() { return this.sky.now(); } weather(): Sky { return this.sky; } isTitleAutoplay(): boolean { return this.titleAutoplay; } titleAutoplaySubject(): Person | null { return this.person(this.titleBuilder); }
  revision(): bigint { return this.changes; } roadRevision(): bigint { return this.roadChanges; } objectRevision(): bigint { return this.changes - this.roadOnlyChanges; }
  roadChanged(onlyRoad = true): void { ++this.changes; ++this.roadChanges; if (onlyRoad) ++this.roadOnlyChanges; }
  notify(text: string): void { this.notices.push(text); }
  roll(): number { this.dice ^= this.dice << 13; this.dice ^= this.dice >>> 17; this.dice ^= this.dice << 5; this.dice >>>= 0; return f32((this.dice >>> 8) / 16777216); }
}
