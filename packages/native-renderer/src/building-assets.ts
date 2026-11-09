import { setBuildingAppearanceSource } from '../../engine/src/building-appearance';
import { BUILDING_ASSETS } from '../../content/src/assets';
import { Structure, structureSpec, type Stage } from '../../engine/src/building-catalog';
import {
  decodeBuildingAsset,
  validateBuildingAsset,
  buildingVariant,
  type BuildingAsset,
} from './building-asset';
import { buildingRiseAnimation, type RiseAnimation } from './building-animation';
import type { Model } from './building-model';
const ids = [
  'camp',
  'tent',
  'cottage',
  'townhouse',
  'manor',
  'market-stalls',
  'market-hall',
  'bazaar',
  'farm',
  'lumberyard',
  'quarry',
  'well',
  'storehouse',
  'shrine',
  'mage-tower',
  'portal',
  'tavern',
  'hostel',
  'inn',
  'grand-inn',
  'guild',
  'guild-hall',
  'chapel',
  'weaponsmith',
  'armorer',
  'apothecary',
  'palisade',
  'keep',
  'castle',
  'torch',
];
const slots = [1, 12, 6, 6, 6, 4, 12, 4, 1, 1, 1, 1, 1, 1, 1, 1, 3, 4, 3, 3, 1, 1, 4, 3, 3, 3, 2, 2, 2, 1];
const originals = Object.values(BUILDING_ASSETS);
let assets: BuildingAsset[] = [];
const revisions: bigint[] = Array.from({ length: Structure.Count }, () => 0n);
let generation = 0n;
function index(kind: Structure): number {
  if (!Number.isInteger(kind) || kind < 0 || kind >= Structure.Count)
    throw new Error('unknown building structure');
  return kind;
}
export function validateBuildingCompatibility(asset: BuildingAsset, kind: Structure): void {
  const i = index(kind);
  validateBuildingAsset(asset);
  if (asset.id !== ids[i]) throw new Error('id: expected ' + ids[i]);
  if (asset.footprint !== structureSpec(i).size)
    throw new Error('footprint: incompatible with game structure ' + asset.id);
  if (asset.variants.length !== slots[i]) throw new Error(`variants: ${asset.id} requires ${slots[i]} slots`);
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return (
      Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every((k) => Object.hasOwn(right, k) && equal(left[k], right[k]))
    );
  }
  return false;
}
const sameAsset = (a: BuildingAsset | undefined, b: BuildingAsset): boolean => equal(a, b);
/** Stage the complete ordered native catalog before changing any accepted asset. */
export function loadBuildingAssetCatalog(sources: readonly (BuildingAsset | string)[]): void {
  if (sources.length !== Structure.Count)
    throw new Error(`Building assets: expected ${Structure.Count} files`);
  const staged = sources.map((source, kind) => {
    const asset = typeof source === 'string' ? decodeBuildingAsset(source) : source;
    validateBuildingCompatibility(asset, kind);
    return structuredClone(asset);
  });
  let changed = !generation;
  for (let i = 0; i < staged.length; i++)
    if (!sameAsset(assets[i], staged[i])) {
      revisions[i]++;
      changed = true;
    }
  assets = staged;
  if (changed) generation++;
}
function ready(): void {
  if (generation) return;
  const staged = ids.map((id, i) => {
    const source = originals.find((asset) => asset.id === id);
    if (!source) throw new Error('Building assets: missing ' + id);
    const a = decodeBuildingAsset(JSON.stringify(source));
    validateBuildingCompatibility(a, i);
    return a;
  });
  assets = staged;
  revisions.fill(1n);
  generation = 1n;
}
export const buildingAssetId = (kind: Structure): string => ids[index(kind)];
export function buildingAsset(kind: Structure): BuildingAsset {
  ready();
  return assets[index(kind)];
}
export function buildingAppearanceRevision(kind: Structure): bigint {
  ready();
  return revisions[index(kind)];
}
export function buildingCatalogGeneration(): bigint {
  ready();
  return generation;
}
export const buildingAssetsWarning = (): string => '';
export function applyBuildingAsset(source: BuildingAsset | string): void {
  const asset = typeof source === 'string' ? decodeBuildingAsset(source) : source,
    i = ids.indexOf(asset.id);
  if (i < 0) throw new Error('id: unknown game building ' + asset.id);
  validateBuildingCompatibility(asset, i);
  ready();
  if (!sameAsset(assets[i], asset)) {
    assets[i] = structuredClone(asset);
    revisions[i]++;
    generation++;
  }
}
export function structureModel(kind: Structure, variant: number): Model {
  return structuredClone(buildingVariant(buildingAsset(kind), variant));
}
export function riseAnimation(
  kind: Structure,
  variant: number,
  replaced: readonly Stage[] = [],
  angle = 0,
): RiseAnimation {
  return buildingRiseAnimation(
    structureModel(kind, variant),
    structureSpec(kind).size,
    replaced.map((stage) => ({
      model: structureModel(stage.kind, stage.variant),
      footprint: structureSpec(stage.kind).size,
      dx: stage.dx,
      dy: stage.dy,
    })),
    angle,
  );
}

setBuildingAppearanceSource((kind, variant) => buildingVariant(buildingAsset(kind), variant));
