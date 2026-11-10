import { Product, Resources, Structure } from './building-catalog';
import type { Person } from './person';

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
  'woodcutting' | 'mining' | 'construction' | 'farming' | 'watering' | 'sawing' | 'crafting';
export type EquipmentVisual =
  'axe' | 'pickaxe' | 'hammer' | 'sword' | 'bow' | 'staff' | 'mace' | 'hoe' | 'wateringCan' | 'saw';
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
  attackBonus: number;
  defense: number;
  reach: number;
  work: readonly WorkKind[];
  workshop: Structure | null;
  cost: Resources;
  seconds: number;
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
const entry = (id: string, name: string, data: Partial<ItemSpec>): ItemSpec => ({
  id,
  name,
  category: 'resource',
  description: name,
  maximumStack: 20,
  minimumLevel: 1,
  slots: [],
  visual: null,
  product: Product.None,
  attackBonus: 0,
  defense: 0,
  reach: 0.9,
  work: [],
  workshop: null,
  cost: new Resources(),
  seconds: 5,
  ...data,
});
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
    attackBonus,
    workshop: Structure.Weaponsmith,
    cost: new Resources(2, wood, stone),
    description: `Improves ${work.join(' and ')}; can serve as a melee weapon.`,
  });
const weapon = (
  id: string,
  name: string,
  visual: EquipmentVisual,
  attackBonus: number,
  reach: number,
  level: number,
  cost: Resources,
): ItemSpec =>
  entry(id, name, {
    category: 'weapon',
    maximumStack: 1,
    slots: ['weapon'],
    visual,
    attackBonus,
    reach,
    minimumLevel: level,
    workshop: Structure.Weaponsmith,
    cost,
    description: `An equipped weapon adding ${attackBonus} attack damage.`,
  });
const armor = (
  id: string,
  name: string,
  slot: EquipmentSlot,
  defense: number,
  level: number,
  cost: Resources,
): ItemSpec =>
  entry(id, name, {
    category: 'armor',
    maximumStack: 1,
    slots: [slot],
    defense,
    minimumLevel: level,
    workshop: Structure.Armorer,
    cost,
    description: `Reduces incoming damage by ${Math.round(defense * 100)}%.`,
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
  entry('bones', 'Bones', { product: Product.Bones, description: 'Remains gathered from hunts and defeated monsters. Offered to Ymir to shape a new life.' }),
  tool('axe', 'Wood axe', 'axe', ['woodcutting'], 0.6, 2, 2),
  tool('pickaxe', 'Stone pick', 'pickaxe', ['mining'], 0.5, 2, 3),
  tool('hammer', 'Craft hammer', 'hammer', ['construction', 'crafting'], 0.4, 1, 2),
  tool('hoe', 'Farm hoe', 'hoe', ['farming'], 0.3, 2, 1),
  tool('watering-can', 'Watering can', 'wateringCan', ['watering'], 0.1, 1, 2),
  tool('saw', 'Wood saw', 'saw', ['sawing'], 0.35, 2, 2),
  weapon('sword', 'Iron sword', 'sword', 1.2, 0.9, 2, new Resources(8, 1, 4)),
  weapon('bow', 'Hunting bow', 'bow', 0.8, 3, 2, new Resources(6, 5, 1)),
  weapon('staff', 'Rune staff', 'staff', 0.9, 2.5, 3, new Resources(8, 4, 1, 0, 2)),
  weapon('mace', 'Stone mace', 'mace', 1, 0.9, 2, new Resources(6, 2, 4)),
  armor('cap', 'Leather cap', 'head', 0.03, 1, new Resources(2, 1, 0, 2)),
  armor('helmet', 'Iron helmet', 'head', 0.08, 3, new Resources(6, 0, 4)),
  armor('leather-armor', 'Leather armor', 'body', 0.1, 1, new Resources(4, 2, 0, 4)),
  armor('mail-armor', 'Mail armor', 'body', 0.2, 5, new Resources(12, 0, 8)),
  armor('robe', 'Runic robe', 'body', 0.08, 2, new Resources(5, 1, 0, 3, 1)),
  armor('boots', 'Leather boots', 'feet', 0.04, 1, new Resources(3, 1, 0, 2)),
  armor('gloves', 'Work gloves', 'hands', 0.03, 1, new Resources(2, 1, 0, 1)),
  armor('shield', 'Wooden shield', 'offhand', 0.1, 2, new Resources(4, 4, 1)),
  armor('cloak', 'Travel cloak', 'accessory', 0.04, 1, new Resources(3, 1, 0, 2)),
];
const items = new Map(itemCatalog.map((item) => [item.id, item]));
export const itemSpec = (id: string): ItemSpec | null => items.get(id) ?? null;
export const productItem = (product: Product): ItemSpec | null =>
  itemCatalog.find((item) => item.category === 'resource' && item.product === product) ?? null;
export function equippedItem(person: Person, slot: EquipmentSlot): ItemSpec | null {
  const index = person.equipment[slot],
    stack = person.inventory[index - 1];
  const item = stack ? itemSpec(stack.item) : null;
  return item && stack?.quantity === 1 && item.minimumLevel <= person.level && item.slots.includes(slot)
    ? item
    : null;
}
export function combatItem(person: Person): ItemSpec | null {
  const weapon = equippedItem(person, 'weapon');
  if (weapon) return weapon;
  const tools = [equippedItem(person, 'tool1'), equippedItem(person, 'tool2')].filter(
    (item): item is ItemSpec => !!item,
  );
  return tools.sort((a, b) => b.attackBonus - a.attackBonus || a.id.localeCompare(b.id))[0] ?? null;
}
export function workItem(person: Person, kind: WorkKind): ItemSpec | null {
  return (
    [equippedItem(person, 'tool1'), equippedItem(person, 'tool2')].find((item) =>
      item?.work.includes(kind),
    ) ?? null
  );
}
export const baseAttack = 1;
export const attackDamage = (person: Person): number => baseAttack + (combatItem(person)?.attackBonus ?? 0);
export const attackReach = (person: Person): number => combatItem(person)?.reach ?? 0.9;
export const armorProtection = (person: Person): number =>
  Math.min(
    0.7,
    equipmentSlots.reduce((total, slot) => total + (equippedItem(person, slot)?.defense ?? 0), 0),
  );
export const workEfficiency = (person: Person, kind: WorkKind): number => (workItem(person, kind) ? 1 : 0.4);
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
