// The engine reads the same live asset catalog as the renderer without importing
// a rendering backend. The default catalog is the original authored JSON.
import { BUILDING_ASSETS } from '../../content/src/assets';
import { Structure } from './building-catalog';
import { f32 } from './numeric';
export interface EntranceBlock {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  base: number;
  door: boolean;
}
export interface EntranceModel {
  blocks: readonly EntranceBlock[];
}
export type BuildingAppearanceSource = (kind: Structure, variant: number) => EntranceModel;
const defaults = Object.fromEntries(
  Object.entries(BUILDING_ASSETS).map(([kind, asset]) => [
    kind,
    asset.variants.map((model) => ({
      blocks: model.blocks.map((block) => ({
        x0: f32(block.bounds[0]),
        y0: f32(block.bounds[1]),
        x1: f32(block.bounds[2]),
        y1: f32(block.bounds[3]),
        base: f32(block.base),
        door: !!block.door,
      })),
    })),
  ]),
);
let source: BuildingAppearanceSource = (kind, variant) => {
  const models = defaults[Structure[kind]];
  return models[variant % models.length];
};
export function setBuildingAppearanceSource(next: BuildingAppearanceSource): void {
  source = next;
}
export function buildingEntranceModel(kind: Structure, variant: number): EntranceModel {
  return source(kind, variant);
}
