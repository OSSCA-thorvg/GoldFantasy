import { Tool, toolStructure } from '../../../../packages/engine/src/game-tools';
import {
  toolAvailable,
  unlockRequirements,
  type UnlockRequirement,
} from '../../../../packages/engine/src/settlement-progression';
import { Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import type { Town } from '../../../../packages/engine/src/town';
import type { HudGlyph } from './hud-actions';
export interface ToolInfo {
  label: string;
  key: string;
  hint: string;
}
/** Indexed by `Tool`. */
export const toolInfo: readonly ToolInfo[] = [
  {
    label: 'Select',
    key: 'Q',
    hint: 'Click or drag to select units. Right-click their own housing with units selected to rest. Right-click gives a contextual order.',
  },
  { label: 'Road', key: 'D', hint: 'Hold and draw a road in one stroke. Release to build; Esc cancels.' },
  {
    label: 'Pave',
    key: 'P',
    hint: 'Click a laid road to pave it with stone: people walk faster on cobbles.',
  },
  {
    label: 'Fields',
    key: 'E',
    hint: 'Drag a rectangle beside a road near a farmhouse, or click corners to outline any shape.',
  },
  { label: 'Camp', key: 'C', hint: '' },
  { label: 'Tent', key: 'T', hint: '' },
  { label: 'Farm', key: 'F', hint: '' },
  { label: 'Wood', key: 'L', hint: '' },
  { label: 'Quarry', key: 'Z', hint: '' },
  { label: 'Well', key: 'W', hint: '' },
  { label: 'Store', key: 'J', hint: '' },
  { label: 'Market', key: 'M', hint: '' },
  { label: 'Tavern', key: 'Y', hint: '' },
  { label: 'Inn', key: 'I', hint: '' },
  { label: 'Guild', key: 'U', hint: '' },
  { label: 'Chapel', key: 'G', hint: '' },
  { label: 'Smithy', key: 'B', hint: 'Residents make weapons, shields and armor here, one at a time.' },
  { label: 'Armor', key: '', hint: '' },
  { label: 'Potion', key: 'O', hint: '' },
  { label: 'Altar', key: 'H', hint: '' },
  { label: 'Mage', key: 'K', hint: '' },
  { label: 'Portal', key: 'V', hint: '' },
  { label: 'Clear', key: 'X', hint: 'Demolish a building, a field or a road.' },
  { label: 'Torch', key: '', hint: 'Place a torch on a completed road.' },
  { label: 'Sawmill', key: '', hint: '' },
  { label: 'Stoneworks', key: '', hint: '' },
  { label: 'Timber store', key: '', hint: '' },
  { label: 'Granary', key: '', hint: '' },
  { label: 'Stone store', key: '', hint: '' },
  { label: 'Tower', key: '', hint: '' },
  { label: 'Yard', key: '', hint: '' },
  { label: 'Runestone', key: '', hint: '' },
  { label: 'Workbench', key: '', hint: 'Residents make tools here, one at a time.' },
];
export interface BuildGroup {
  name: string;
  glyph: HudGlyph;
  tools: Tool[];
}
export const buildMenuGroups: readonly BuildGroup[] = [
  { name: 'Roads', glyph: 'roads', tools: [Tool.Road, Tool.Pave, Tool.Torch] },
  { name: 'Housing', glyph: 'housing', tools: [Tool.Camp, Tool.Tent, Tool.Workbench, Tool.Weaponsmith] },
  {
    name: 'Food & materials',
    glyph: 'materials',
    tools: [Tool.Farm, Tool.Field, Tool.Lumberyard, Tool.Quarry, Tool.Sawmill, Tool.Stoneworks],
  },
  {
    name: 'Water & storage',
    glyph: 'storage',
    tools: [Tool.Well, Tool.Storehouse, Tool.WoodStore, Tool.Granary, Tool.StoneStore],
  },
  { name: 'Trade & outfitters', glyph: 'trade', tools: [Tool.Market, Tool.Apothecary] },
  { name: 'Lodging & leisure', glyph: 'lodging', tools: [Tool.Inn, Tool.Tavern] },
  {
    name: 'Arms & defence',
    glyph: 'attack',
    tools: [Tool.Guild, Tool.TrainingYard, Tool.Watchtower],
  },
  {
    name: 'Faith & arcane',
    glyph: 'faith',
    tools: [Tool.Shrine, Tool.Runestone, Tool.Chapel, Tool.MageTower, Tool.Portal],
  },
];
/** The full name a notice or a requirement list uses ("Training yard", not the card's "Yard"). */
export function toolName(tool: Tool): string {
  const kind = toolStructure(tool);
  return kind === undefined ? (toolInfo[tool]?.label ?? '') : structureSpec(kind).name;
}
/** What placing a tool still needs, in the order the engine checks it; empty when nothing is asked. */
export function toolRequirements(town: Town, tool: Tool): UnlockRequirement[] {
  const kind = toolStructure(tool);
  if (kind !== undefined) return unlockRequirements(town, kind);
  const needs =
    tool === Tool.Road || tool === Tool.Pave ? Structure.Camp : tool === Tool.Field ? Structure.Farm : undefined;
  if (needs === undefined) return [];
  return [{ text: 'Complete ' + structureSpec(needs).name, done: toolAvailable(town, tool) }];
}
