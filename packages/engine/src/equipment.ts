import { Product, Resources, Structure, resourceKeys } from './building-catalog';
import { Activity, type Person } from './person';

export const inventoryColumns = 4,
  inventoryRows = 4,
  backpackSize = 15;
export const equipmentSlots = [
  'weapon',
  'tool1',
  'tool2',
  'head',
  'body',
  'feet',
  'hands',
  'offhand',
  'accessory',
] as const;
export type EquipmentSlot = (typeof equipmentSlots)[number];
export type WorkKind =
  | 'woodcutting'
  | 'mining'
  | 'construction'
  | 'farming'
  | 'watering'
  | 'sawing'
  | 'crafting'
  /** Laying and mending roads, breaking in a new field. */
  | 'digging'
  /** Tending a field's standing crop in summer and autumn. */
  | 'reaping';
/** Shapes drawn in the hand. */
export type HeldVisual =
  | 'axe'
  | 'pickaxe'
  | 'hammer'
  | 'sword'
  | 'bow'
  | 'staff'
  | 'mace'
  | 'hoe'
  | 'wateringCan'
  | 'saw'
  | 'shovel'
  | 'sickle'
  | 'knife'
  | 'spear';
/** Every drawn shape: what is held, and the pack basket worn on the back. */
export type EquipmentVisual = HeldVisual | 'basket';
export type ItemMaterial = 'wood' | 'stone' | 'iron';
export interface ItemSpec {
  id: string;
  name: string;
  category: 'resource' | 'tool' | 'weapon' | 'armor';
  description: string;
  maximumStack: number;
  minimumLevel: number;
  slots: readonly EquipmentSlot[];
  visual: EquipmentVisual | null;
  product: Product;
  /** Kilograms per unit carried. */
  weight: number;
  attackBonus: number;
  defense: number;
  reach: number;
  work: readonly WorkKind[];
  /** Work done per second with this tool in hand; bare hands manage `bareHandsRate`. */
  rate: number;
  /** What the head, blade or body is made of, for drawing; null where it means nothing (resources, cloth, leather). */
  material: ItemMaterial | null;
  /** Where it is crafted; null for what is no longer made (old saves still hold it). */
  workshop: Structure | null;
  cost: Resources;
  seconds: number;
  /** Extra share of food and bones from a hunt the wearer makes the kill in. */
  huntBonus: number;
  /** Kilograms more carried before slowing and before the pack is full. */
  carry: number;
  /** Make within its kind: 1 wood, 2 stone, 3 iron; 0 outside the tiers. */
  tier: number;
  /** The level its workshop must have reached to make it. */
  stationLevel: number;
  /** Share of blows a shield turns aside; 0 for everything else. */
  block: number;
  /** Hands it takes; a shield needs the other one free. */
  hands: 1 | 2;
}
export interface ItemStack {
  item: string;
  quantity: number;
}
export type Equipment = Record<EquipmentSlot, number>;
export const emptyEquipment = (): Equipment => ({
  weapon: -1,
  tool1: -1,
  tool2: -1,
  head: -1,
  body: -1,
  feet: -1,
  hands: -1,
  offhand: -1,
  accessory: -1,
});
const tierOf: Record<ItemMaterial, number> = { wood: 1, stone: 2, iron: 3 };
// Long hafts, bows and staves take both hands, as the renderer poses them.
const twoHandedVisuals: readonly (EquipmentVisual | null)[] = ['axe', 'pickaxe', 'hoe', 'shovel', 'spear', 'bow', 'staff'];
const entry = (id: string, name: string, data: Partial<ItemSpec>): ItemSpec => {
  const item: ItemSpec = {
    id,
    name,
    category: 'resource',
    description: name,
    maximumStack: 20,
    minimumLevel: 1,
    slots: [],
    visual: null,
    product: Product.None,
    weight: 1,
    attackBonus: 0,
    defense: 0,
    reach: 0.9,
    work: [],
    rate: 0,
    material: null,
    workshop: null,
    cost: new Resources(),
    seconds: 5,
    huntBonus: 0,
    carry: 0,
    tier: 0,
    stationLevel: 1,
    block: 0,
    hands: 1,
    ...data,
  };
  return {
    ...item,
    tier: data.tier ?? (item.category !== 'resource' && item.material ? tierOf[item.material] : 0),
    hands: data.hands ?? (twoHandedVisuals.includes(item.visual) ? 2 : 1),
  };
};
export const bareHandsRate = 0.4,
  woodenRate = 0.7,
  stoneRate = 0.85;
/** An upgrade costs this share of making the better item from scratch, and takes this share of its time. */
export const upgradeShare = 0.6;
const tool = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  work: WorkKind[],
  attackBonus: number,
  wood: number,
  stone: number,
): ItemSpec =>
  entry(id, name, {
    category: 'tool',
    maximumStack: 1,
    slots: ['tool1', 'tool2'],
    visual,
    work,
    rate: 1,
    material: 'iron',
    attackBonus,
    workshop: Structure.Workbench,
    stationLevel: 3,
    cost: new Resources(2, wood, stone),
    seconds: 12,
    description: 'Made at a workbench fitted for iron. The best tool of its kind; it can serve as a weapon at a pinch.',
  });
// Wooden tools: whittled at a first workbench from wood and a little stone, no gold.
const woodenTool = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  work: WorkKind[],
  attackBonus: number,
  wood: number,
  stone: number,
): ItemSpec =>
  entry(id, name, {
    category: 'tool',
    maximumStack: 1,
    slots: ['tool1', 'tool2'],
    visual,
    work,
    rate: woodenRate,
    material: 'wood',
    attackBonus,
    workshop: Structure.Workbench,
    cost: new Resources(0, wood, stone),
    seconds: 6,
    description: 'Made at a workbench. Better than bare hands; stone and iron tools are better still.',
  });
// Stone tools: a stone head lashed to a haft, once the workbench has been upgraded.
const stoneTool = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  work: WorkKind[],
  attackBonus: number,
  wood: number,
  stone: number,
): ItemSpec => ({
  ...woodenTool(id, name, visual, work, attackBonus, wood, stone),
  rate: stoneRate,
  material: 'stone',
  tier: 2,
  stationLevel: 2,
  seconds: 9,
  description: 'Made at an upgraded workbench with a stone head: better than wood, short of iron.',
});
const shovelText =
    'Digs: lays and mends roads and breaks in new fields, faster than a hammer or a hoe of the same make.',
  sickleText = "Cuts the standing crop: a farmhand's field work in summer and autumn goes faster than with a hoe.",
  spearText = 'A long thrusting weapon: reaches farther than a sword and runs through one enemy behind its target.';
const smithText = [
  '',
  'Made at the smithy. Hits harder than fists; stone and iron hit harder still.',
  'Made at an upgraded smithy with a stone head or edge: harder than wood, short of iron.',
  'Forged in iron at the smithy at its highest level: the hardest-hitting of its kind.',
];
/** A smithy weapon of `tier`; the smithy must be at that level, the wielder at `level`. */
const weapon = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  material: ItemMaterial,
  tier: number,
  attackBonus: number,
  reach: number,
  cost: Resources,
): ItemSpec =>
  entry(id, name, {
    category: 'weapon',
    maximumStack: 1,
    slots: ['weapon'],
    visual,
    material,
    tier,
    attackBonus,
    reach,
    minimumLevel: smithLevels[tier],
    workshop: Structure.Weaponsmith,
    stationLevel: tier,
    cost,
    seconds: smithSeconds[tier],
    description: visual === 'spear' ? spearText : smithText[tier],
  });
/** Level a resident needs to wield or wear smithy gear of each tier. */
const smithLevels = [1, 1, 3, 5],
  smithSeconds = [8, 8, 12, 16];
const shieldText = [
  '',
  'A round board shield for the free hand: turns some blows aside. Not with a spear, a bow or a staff.',
  'A board shield studded with stone: turns more blows aside. Not with a spear, a bow or a staff.',
  'An iron-rimmed shield: turns the most blows aside. Not with a spear, a bow or a staff.',
];
const shield = (id: string, name: string, material: ItemMaterial, tier: number, block: number, weight: number, cost: Resources) =>
  entry(id, name, {
    category: 'armor',
    material,
    tier,
    weight,
    maximumStack: 1,
    slots: ['offhand'],
    block,
    minimumLevel: smithLevels[tier],
    workshop: Structure.Weaponsmith,
    stationLevel: tier,
    cost,
    seconds: smithSeconds[tier],
    description: shieldText[tier],
  });
const armor = (
  id: string,
  name: string,
  slot: EquipmentSlot,
  defense: number,
  level: number,
  cost: Resources,
  material: ItemMaterial | null = null,
): ItemSpec =>
  entry(id, name, {
    category: 'armor',
    material,
    // Worn belongings are light; resources, tools and weapons weigh a kilogram.
    weight: 0.1,
    maximumStack: 1,
    slots: [slot],
    defense,
    minimumLevel: level,
    cost,
    // No longer made; kept so the ones residents own keep working.
    tier: material ? undefined : 1,
    description: 'Worn armor that takes part of every blow.',
  });
const bodyText = [
  '',
  'Laced wooden slats worn over the tunic: takes part of every blow.',
  'Hide sewn with stone plates: takes more of every blow, and weighs more.',
  'Iron rings: takes the most of every blow, and weighs the most.',
];
const bodyArmor = (id: string, name: string, material: ItemMaterial, tier: number, defense: number, weight: number, cost: Resources) => ({
  ...armor(id, name, 'body', defense, smithLevels[tier], cost, material),
  tier,
  weight,
  workshop: Structure.Weaponsmith,
  stationLevel: tier,
  seconds: smithSeconds[tier] + 2,
  description: bodyText[tier],
});
export const itemCatalog: readonly ItemSpec[] = [
  entry('wood', 'Wood', { product: Product.Wood }),
  entry('stone', 'Stone', { product: Product.Stone }),
  entry('food', 'Food', { product: Product.Food }),
  entry('water', 'Water', { product: Product.Water }),
  entry('planks', 'Planks', { product: Product.Planks }),
  entry('cut-stone', 'Cut stone', { product: Product.CutStone }),
  entry('gold', 'Gold', { product: Product.Goods }),
  entry('mana', 'Mana', { product: Product.Mana }),
  entry('bones', 'Bones', { product: Product.Bones, description: 'Remains gathered from hunts and defeated monsters. Offered to Odin, who gives breath to a new settler.' }),
  woodenTool('wooden-axe', 'Wooden axe', 'axe', ['woodcutting'], 0.3, 3, 0),
  woodenTool('wooden-pick', 'Wooden pick', 'pickaxe', ['mining'], 0.25, 3, 1),
  woodenTool('wooden-mallet', 'Wooden mallet', 'hammer', ['construction', 'crafting'], 0.2, 3, 0),
  woodenTool('wooden-hoe', 'Wooden hoe', 'hoe', ['farming'], 0.15, 3, 0),
  { ...woodenTool('wooden-shovel', 'Wooden shovel', 'shovel', ['digging'], 0.2, 3, 0), rate: 0.9, description: shovelText },
  stoneTool('stone-axe', 'Stone axe', 'axe', ['woodcutting'], 0.45, 2, 3),
  stoneTool('stone-pick', 'Stone pick', 'pickaxe', ['mining'], 0.38, 2, 4),
  stoneTool('stone-hammer', 'Stone hammer', 'hammer', ['construction', 'crafting'], 0.3, 2, 3),
  stoneTool('stone-hoe', 'Stone hoe', 'hoe', ['farming'], 0.22, 2, 2),
  { ...stoneTool('flint-sickle', 'Flint sickle', 'sickle', ['reaping'], 0.25, 2, 2), rate: 1.1, description: sickleText },
  {
    ...stoneTool('hunting-knife', 'Hunting knife', 'knife', [], 0.3, 1, 2),
    rate: 0,
    huntBonus: 0.5,
    seconds: 6,
    description: 'Skins and butchers the kill: a hunt brings home more food and bones.',
  },
  weapon('wooden-sword', 'Wooden sword', 'sword', 'wood', 1, 0.5, 0.9, new Resources(0, 4)),
  weapon('wooden-club', 'Wooden club', 'mace', 'wood', 1, 0.45, 0.9, new Resources(0, 4)),
  weapon('short-bow', 'Short bow', 'bow', 'wood', 1, 0.35, 2.6, new Resources(0, 5)),
  weapon('wooden-spear', 'Wooden spear', 'spear', 'wood', 1, 0.4, 1.4, new Resources(0, 4)),
  weapon('wooden-staff', 'Wooden staff', 'staff', 'wood', 1, 0.15, 1.6, new Resources(0, 4)),
  entry('pack-basket', 'Pack basket', {
    category: 'armor',
    maximumStack: 1,
    slots: ['accessory'],
    visual: 'basket',
    material: 'wood',
    weight: 0.5,
    carry: 15,
    workshop: Structure.Workbench,
    cost: new Resources(0, 4),
    seconds: 8,
    description: 'A wicker pack worn on the back: carries more before slowing and before the pack is full.',
  }),
  tool('axe', 'Iron axe', 'axe', ['woodcutting'], 0.6, 2, 2),
  tool('pickaxe', 'Iron pick', 'pickaxe', ['mining'], 0.5, 2, 3),
  tool('hammer', 'Iron hammer', 'hammer', ['construction', 'crafting'], 0.4, 1, 2),
  tool('hoe', 'Iron hoe', 'hoe', ['farming'], 0.3, 2, 1),
  tool('watering-can', 'Watering can', 'wateringCan', ['watering'], 0.1, 1, 2),
  tool('saw', 'Iron saw', 'saw', ['sawing'], 0.35, 2, 2),
  { ...tool('shovel', 'Iron shovel', 'shovel', ['digging'], 0.35, 2, 2), rate: 1.3, description: shovelText },
  { ...tool('sickle', 'Iron sickle', 'sickle', ['reaping'], 0.3, 1, 2), rate: 1.3, description: sickleText },
  weapon('flint-sword', 'Flint sword', 'sword', 'stone', 2, 0.8, 0.9, new Resources(0, 2, 4)),
  weapon('mace', 'Stone mace', 'mace', 'stone', 2, 0.75, 0.9, new Resources(0, 2, 4)),
  weapon('bow', 'Hunting bow', 'bow', 'wood', 2, 0.55, 2.8, new Resources(0, 5, 2)),
  weapon('flint-spear', 'Flint spear', 'spear', 'stone', 2, 0.65, 1.4, new Resources(0, 3, 3)),
  weapon('staff', 'Rune staff', 'staff', 'stone', 2, 0.6, 2.5, new Resources(0, 4, 3)),
  weapon('sword', 'Iron sword', 'sword', 'iron', 3, 1.2, 0.9, new Resources(8, 1, 4)),
  weapon('iron-mace', 'Iron mace', 'mace', 'iron', 3, 1.1, 0.9, new Resources(7, 1, 4)),
  weapon('longbow', 'Longbow', 'bow', 'wood', 3, 0.8, 3, new Resources(6, 6, 1)),
  weapon('spear', 'Iron spear', 'spear', 'iron', 3, 1, 1.4, new Resources(7, 3, 3)),
  weapon('seer-staff', "Seer's staff", 'staff', 'iron', 3, 0.9, 2.5, new Resources(8, 4, 2)),
  shield('shield', 'Wooden shield', 'wood', 1, 0.15, 1, new Resources(0, 5)),
  shield('reinforced-shield', 'Reinforced shield', 'stone', 2, 0.24, 1.5, new Resources(0, 3, 4)),
  shield('iron-shield', 'Iron shield', 'iron', 3, 0.32, 2, new Resources(6, 2, 4)),
  bodyArmor('wooden-armor', 'Wooden armor', 'wood', 1, 0.06, 2, new Resources(0, 8)),
  bodyArmor('studded-armor', 'Stone-studded armor', 'stone', 2, 0.12, 3, new Resources(0, 4, 8)),
  bodyArmor('mail-armor', 'Mail armor', 'iron', 3, 0.2, 4, new Resources(12, 0, 8)),
  {
    // Light enough for a level 3 head, as it always was.
    ...armor('helmet', 'Iron helmet', 'head', 0.06, 3, new Resources(6, 0, 4), 'iron'),
    workshop: Structure.Weaponsmith,
    stationLevel: 3,
    seconds: smithSeconds[3],
    description: 'An iron cap for the head: takes a little of every blow.',
  },
  armor('cap', 'Leather cap', 'head', 0.03, 1, new Resources(2, 1, 0, 2)),
  armor('leather-armor', 'Leather armor', 'body', 0.1, 1, new Resources(4, 2, 0, 4)),
  armor('robe', 'Runic robe', 'body', 0.08, 2, new Resources(5, 1, 0, 3, 1)),
  armor('boots', 'Leather boots', 'feet', 0.04, 1, new Resources(3, 1, 0, 2)),
  armor('gloves', 'Work gloves', 'hands', 0.03, 1, new Resources(2, 1, 0, 1)),
  armor('cloak', 'Travel cloak', 'accessory', 0.04, 1, new Resources(3, 1, 0, 2)),
];
const items = new Map(itemCatalog.map((item) => [item.id, item]));
export const itemSpec = (id: string): ItemSpec | null => items.get(id) ?? null;
export const itemMaterial = (id: string): ItemMaterial | null => itemSpec(id)?.material ?? null;
export const productItem = (product: Product): ItemSpec | null =>
  itemCatalog.find((item) => item.category === 'resource' && item.product === product) ?? null;
export type HandSlot = 'weapon' | 'tool1' | 'tool2';
/** An item whose shape is drawn in the hand. */
export type HeldItem = ItemSpec & { visual: HeldVisual | null };
const isHeld = (item: ItemSpec): item is HeldItem => item.visual !== 'basket';
const handSlot = (slot: EquipmentSlot): slot is HandSlot => slot === 'weapon' || slot === 'tool1' || slot === 'tool2';
export function equippedItem(person: Person, slot: HandSlot): HeldItem | null;
export function equippedItem(person: Person, slot: EquipmentSlot): ItemSpec | null;
export function equippedItem(person: Person, slot: EquipmentSlot): ItemSpec | null {
  const index = person.equipment[slot],
    stack = person.inventory[index - 1];
  const item = stack ? itemSpec(stack.item) : null;
  return item &&
    stack?.quantity === 1 &&
    item.minimumLevel <= person.level &&
    item.slots.includes(slot) &&
    (!handSlot(slot) || isHeld(item))
    ? item
    : null;
}
/** Tools a resident carries, equipped or anywhere in the pack, that they are of a level to use. */
export function carriedTools(person: Person): HeldItem[] {
  const out: HeldItem[] = [];
  for (const stack of person.inventory) {
    const item = stack?.quantity === 1 ? itemSpec(stack.item) : null;
    if (item?.category === 'tool' && item.minimumLevel <= person.level && isHeld(item) && !out.includes(item))
      out.push(item);
  }
  return out;
}
/** The equipped weapon, else the hardest-hitting tool carried, else bare hands (null). */
export function combatItem(person: Person): HeldItem | null {
  const weapon = equippedItem(person, 'weapon');
  if (weapon) return weapon;
  return carriedTools(person).sort((a, b) => b.attackBonus - a.attackBonus || a.id.localeCompare(b.id))[0] ?? null;
}
/** The best tool carried for any of `kinds`, equipped or in the pack; with none, the work goes at `bareHandsRate`. */
export function toolFor(person: Person, kinds: readonly WorkKind[]): HeldItem | null {
  let best: HeldItem | null = null;
  for (const item of carriedTools(person))
    if (item.work.some((kind) => kinds.includes(kind)) && (!best || item.rate > best.rate || (item.rate === best.rate && item.id < best.id)))
      best = item;
  return best;
}
export const taskEfficiency = (person: Person, kinds: readonly WorkKind[]): number =>
  toolFor(person, kinds)?.rate ?? bareHandsRate;
const roadKinds: readonly WorkKind[] = ['construction', 'digging'];
/** The best tool carried for `kind`. On a road a shovel serves as well as a hammer, so it is the one in hand. */
export function workItem(person: Person, kind: WorkKind): HeldItem | null {
  return toolFor(person, kind === 'construction' && person.activity === Activity.Roadwork ? roadKinds : [kind]);
}
/** The item that adds most to a hunt's food and bones: a carried tool or worn gear, or null. */
export function huntItem(person: Person): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const item of [...carriedTools(person), ...equipmentSlots.map((slot) => equippedItem(person, slot))])
    if (item && item.huntBonus > (best?.huntBonus ?? 0)) best = item;
  return best;
}
/** Kilograms the worn gear adds to what a resident carries before slowing and before the pack is full. */
export const carryBonus = (person: Person): number =>
  equipmentSlots.reduce((total, slot) => total + (equippedItem(person, slot)?.carry ?? 0), 0);
/** The resident carries this item, or a make of the same kind: 'held' equipped, 'owned' in the pack, 'better' a stronger make. */
export function ownedMake(person: Person, item: ItemSpec): 'held' | 'owned' | 'better' | '' {
  let found: 'held' | 'owned' | 'better' | '' = '';
  person.inventory.forEach((stack, index) => {
    const other = stack ? itemSpec(stack.item) : null;
    if (!other) return;
    if (other.id === item.id) {
      const worn = equipmentSlots.some((slot) => person.equipment[slot] === index + 1);
      if (worn && item.category !== 'tool') found = 'held';
      else if (found !== 'held') found = 'owned';
    } else if (!found && betterMake(other, item)) found = 'better';
  });
  return found;
}
/** True when the resident carries nothing of this item's kind, of any make. */
export const lacksKind = (person: Person, item: ItemSpec): boolean =>
  !person.inventory.some((stack) => {
    const other = stack ? itemSpec(stack.item) : null;
    return !!other && (other.id === item.id || (other.tier > 0 && item.tier > 0 && lineOf(other) === lineOf(item)));
  });
export const craftsAt = (item: ItemSpec, kind: Structure): boolean => item.workshop !== null && kind === item.workshop;
/** Buildings where residents craft, one at a time, in the open at the door. */
export const isCraftStation = (kind: Structure): boolean =>
  kind === Structure.Workbench || kind === Structure.Weaponsmith || kind === Structure.Armorer;
export const baseAttack = 1;
export const attackDamage = (person: Person): number =>
  (baseAttack + (combatItem(person)?.attackBonus ?? 0)) * person.attackMultiplier();
export const attackReach = (person: Person): number => combatItem(person)?.reach ?? 0.9;
export const armorProtection = (person: Person): number =>
  Math.min(
    0.7,
    equipmentSlots.reduce((total, slot) => total + (equippedItem(person, slot)?.defense ?? 0), 0),
  );
export const workEfficiency = (person: Person, kind: WorkKind): number =>
  workItem(person, kind)?.rate ?? bareHandsRate;
/** Seconds to fell a tree or break a load of stone at `rate`; matches `harvestDuration`. */
export const harvestSeconds = (rate: number): number => 6 / rate;
const workVerbs: Record<WorkKind, string> = {
  woodcutting: 'Fells trees',
  mining: 'Breaks stone',
  construction: 'Builds',
  farming: 'Farms',
  watering: 'Waters crops',
  sawing: 'Saws planks',
  crafting: 'Crafts',
  digging: 'Tills and lays roads',
  reaping: 'Tends summer and autumn crops',
};
/** Items of one kind in different makes share a line: a wooden, a flint and an iron sword. */
export const lineOf = (item: ItemSpec): string =>
  `${item.category}|${item.visual ?? item.slots.join()}|${item.work.join()}`;
const sameLine = (a: ItemSpec, b: ItemSpec): boolean => a.tier > 0 && b.tier > 0 && lineOf(a) === lineOf(b);
/** The next weaker make of the same kind (stone axe for an iron one), preferring what is still made, or null. */
export function lowerTier(item: ItemSpec): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const other of itemCatalog)
    if (
      sameLine(other, item) &&
      other.tier < item.tier &&
      (!best ||
        other.tier > best.tier ||
        (other.tier === best.tier && best.workshop === null && other.workshop !== null))
    )
      best = other;
  return best;
}
/** The next better make that is still made (a flint sword for a wooden one), or null at the top. */
export function upperTier(item: ItemSpec): ItemSpec | null {
  let best: ItemSpec | null = null;
  for (const other of itemCatalog)
    if (sameLine(other, item) && other.workshop !== null && other.tier > item.tier && (!best || other.tier < best.tier))
      best = other;
  return best;
}
/** True when `better` is a stronger make of the same kind as `item`. */
export const betterMake = (better: ItemSpec, item: ItemSpec): boolean => sameLine(better, item) && better.tier > item.tier;
/** What turning a weaker make into `target` costs: a share of making it new, rounded up. */
export function upgradeCost(target: ItemSpec): Resources {
  const out = new Resources();
  for (const key of resourceKeys) out[key] = Math.ceil(target.cost[key] * upgradeShare - 1e-9);
  return out;
}
export const upgradeSeconds = (target: ItemSpec): number => Math.round(target.seconds * upgradeShare * 10) / 10;
export const isShield = (item: ItemSpec | null): boolean => !!item && item.block > 0 && item.slots.includes('offhand');
/** The shield this resident can raise: one in the off hand while the item in hand leaves that hand free. */
export function raisedShield(person: Person): ItemSpec | null {
  const shield = equippedItem(person, 'offhand');
  return isShield(shield) && (combatItem(person)?.hands ?? 1) === 1 ? shield : null;
}
/** What gear changes in plain words; tiers read apart by naming the make they beat. Empty for resources. */
export function gearEffect(item: ItemSpec): string {
  if (item.huntBonus > 0) return 'Brings more home from a hunt';
  if (item.carry > 0) return 'Carries more before slowing down';
  const lower = lowerTier(item),
    than = lower ? ` than a ${lower.name.toLowerCase()}` : '';
  if (item.category === 'tool') {
    const verb = item.work.length === 2 ? 'Builds and crafts' : workVerbs[item.work[0]];
    if (!lower && item.work[0] === 'digging') return `${verb} faster than a mallet or a hoe`;
    if (!lower && item.work[0] === 'reaping') return `${verb} faster than a hoe`;
    return `${verb} faster${than}`;
  }
  if (isShield(item)) return lower ? `Turns more blows aside${than}` : 'Turns some blows aside';
  if (item.visual === 'spear')
    return lower ? `Hits harder${than} and runs an enemy through` : 'Reaches further and runs an enemy through';
  if (item.category === 'weapon') return lower ? `Hits harder${than}` : 'Hits harder than fists';
  if (item.category === 'armor' && item.slots.includes('body') && item.workshop !== null)
    return lower ? `Takes less damage than ${lower.name.toLowerCase()}` : 'Takes less damage';
  if (item.category === 'armor') return item.defense >= 0.15 ? 'Takes much less damage' : 'Takes less damage';
  return '';
}
export interface InventorySlot {
  slot: number;
  item: ItemSpec | null;
  quantity: number;
  equipped: EquipmentSlot[];
  cargo: boolean;
}
export function inventorySlots(person: Person): readonly InventorySlot[] {
  return [
    {
      slot: 0,
      item: person.carrying > 0 ? productItem(person.carriedProduct) : null,
      quantity: person.carrying,
      equipped: [],
      cargo: true,
    },
    ...person.inventory.map((stack, index) => ({
      slot: index + 1,
      item: stack ? itemSpec(stack.item) : null,
      quantity: stack?.quantity ?? 0,
      equipped: equipmentSlots.filter((slot) => person.equipment[slot] === index + 1),
      cargo: false,
    })),
  ];
}
export function inventoryRoom(person: Person, id: string): number {
  const item = itemSpec(id);
  return item
    ? person.inventory.reduce(
        (room, stack) =>
          room + (!stack ? item.maximumStack : stack.item === id ? item.maximumStack - stack.quantity : 0),
        0,
      )
    : 0;
}
export function addInventory(person: Person, id: string, quantity = 1): boolean {
  const item = itemSpec(id);
  if (!item || !Number.isSafeInteger(quantity) || quantity <= 0 || inventoryRoom(person, id) < quantity)
    return false;
  for (const stack of person.inventory)
    if (stack?.item === id) {
      const added = Math.min(quantity, item.maximumStack - stack.quantity);
      stack.quantity += added;
      quantity -= added;
    }
  for (let index = 0; quantity > 0 && index < backpackSize; ++index)
    if (!person.inventory[index]) {
      const added = Math.min(quantity, item.maximumStack);
      person.inventory[index] = { item: id, quantity: added };
      quantity -= added;
    }
  return true;
}
export function validInventory(person: Person): boolean {
  if (!Array.isArray(person.inventory) || person.inventory.length !== backpackSize) return false;
  if (
    !person.equipment ||
    equipmentSlots.some(
      (slot) =>
        !Number.isInteger(person.equipment[slot]) ||
        person.equipment[slot] < -1 ||
        person.equipment[slot] === 0 ||
        person.equipment[slot] > backpackSize,
    )
  )
    return false;
  for (const stack of person.inventory) {
    if (stack === null) continue;
    const item = stack && typeof stack.item === 'string' ? itemSpec(stack.item) : null;
    if (
      !item ||
      !Number.isInteger(stack.quantity) ||
      stack.quantity < 1 ||
      stack.quantity > item.maximumStack
    )
      return false;
  }
  const used = new Set<number>();
  for (const slot of equipmentSlots)
    if (person.equipment[slot] >= 1) {
      if (used.has(person.equipment[slot]) || !equippedItem(person, slot)) return false;
      used.add(person.equipment[slot]);
    }
  return true;
}
