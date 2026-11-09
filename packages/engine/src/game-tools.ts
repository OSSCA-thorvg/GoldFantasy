import { Structure } from './building-catalog';
import { point, type Outline, type Point } from './geometry';
import type { RoadPath } from './road-network';

// Numeric values and ordering are the native GameApp input contract.
export enum Tool {
  Select,
  Road,
  Pave,
  Field,
  Camp,
  Tent,
  Farm,
  Lumberyard,
  Quarry,
  Well,
  Storehouse,
  Market,
  Tavern,
  Inn,
  Guild,
  Chapel,
  Weaponsmith,
  Armorer,
  Apothecary,
  Shrine,
  MageTower,
  Portal,
  Demolish,
  Torch,
  Sawmill,
  Stoneworks,
  WoodStore,
  Granary,
  StoneStore,
  Count,
}
export enum PointerButton {
  Primary,
  Secondary,
}
export enum Order {
  None,
  Move,
  Attack,
  Work,
}
export enum PreviewKind {
  None,
  Footprint,
  Road,
  Field,
  Clear,
}
export class Preview {
  kind = PreviewKind.None;
  outline: Outline = [];
  closed = true;
  road: RoadPath = [];
  brush = false;
  active = -1;
  cursor: Point = point();
  valid = false;
  zoom = 1;
}
export function toolStructure(tool: Tool): Structure | undefined {
  switch (tool) {
    case Tool.Sawmill: return Structure.Sawmill;
    case Tool.Stoneworks: return Structure.Stoneworks;
    case Tool.WoodStore: return Structure.WoodStore;
    case Tool.Granary: return Structure.Granary;
    case Tool.StoneStore: return Structure.StoneStore;
    case Tool.Torch:
      return Structure.Torch;
    case Tool.Camp:
      return Structure.Camp;
    case Tool.Tent:
      return Structure.Tent;
    case Tool.Farm:
      return Structure.Farm;
    case Tool.Lumberyard:
      return Structure.Lumberyard;
    case Tool.Quarry:
      return Structure.Quarry;
    case Tool.Well:
      return Structure.Well;
    case Tool.Storehouse:
      return Structure.Storehouse;
    case Tool.Market:
      return Structure.MarketStalls;
    case Tool.Tavern:
      return Structure.Tavern;
    case Tool.Inn:
      return Structure.Hostel;
    case Tool.Guild:
      return Structure.Guild;
    case Tool.Shrine:
      return Structure.Shrine;
    case Tool.MageTower:
      return Structure.MageTower;
    case Tool.Portal:
      return Structure.Portal;
    case Tool.Chapel:
      return Structure.Chapel;
    case Tool.Weaponsmith:
      return Structure.Weaponsmith;
    case Tool.Armorer:
      return Structure.Armorer;
    case Tool.Apothecary:
      return Structure.Apothecary;
    default:
      return undefined;
  }
}
