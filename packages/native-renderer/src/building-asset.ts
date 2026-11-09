import { parseJson, stringifyJson, type JsonValue } from '../../engine/src/native-json';
import { f32 } from '../../engine/src/numeric';
import { RoofShape, Trim, Ornament, type Model, type Block, type Patch } from './building-model';
import type { Rgb } from './paint';
export interface BuildingAsset {
  id: string;
  name: string;
  footprint: number;
  variants: Model[];
}
const shapes = ['flat', 'gable-x', 'gable-y', 'pyramid'],
  trims = ['none', 'timber', 'crenels', 'stakes'],
  ornaments = ['none', 'banner', 'crystal'];
const fail = (path: string, why: string): never => {
  throw new Error(`${path}: ${why}`);
};
const between = (value: number, low: number, high: number) =>
  Number.isFinite(value) && value >= low && value <= high;
function bounds(r: { x0: number; y0: number; x1: number; y1: number }, path: string): void {
  if (![r.x0, r.y0, r.x1, r.y1].every((n) => between(n, -8, 16)))
    fail(path, 'coordinates must be finite and within [-8,16]');
  if (r.x1 <= r.x0) fail(path, 'x1 must exceed x0');
  if (r.y1 <= r.y0) fail(path, 'y1 must exceed y0');
  if (f32(r.x1 - r.x0) > 8 || f32(r.y1 - r.y0) > 8) fail(path, 'rectangle spans must not exceed 8');
}
function fields(value: unknown, path: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'expected an object');
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object).sort())
    if (!allowed.includes(key)) fail(path + '.' + key, 'unknown field');
  return object;
}
function number(value: unknown, path: string): number {
  return typeof value === 'number' ? value : fail(path, 'expected a number');
}
function scalar(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  initial = 0,
  required = false,
): number {
  if (!(key in parent) && !required) return initial;
  const n = number(parent[key], path + '.' + key),
    low = key === 'footprint' ? 0.25 : 0,
    high = key === 'footprint' ? 8 : key === 'delay' ? 120 : 256;
  if (!between(n, low, high)) fail(path + '.' + key, 'number outside supported range');
  return f32(n);
}
function integer(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  initial: number,
  low: number,
  high: number,
): number {
  if (!(key in parent)) return initial;
  const n = number(parent[key], path + '.' + key);
  if (!between(n, low, high) || Math.floor(n) !== n)
    fail(path + '.' + key, 'expected an integer in the supported range');
  return n;
}
function rgb(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  initial: Rgb = [0, 0, 0],
  required = false,
): Rgb {
  if (!(key in parent) && !required) return initial;
  const list = parent[key];
  if (!Array.isArray(list) || list.length !== 3)
    return fail(path + '.' + key, 'expected three color channels');
  const channels = list.map((v, i) => {
    const at = path + '.' + key + `[${i}]`,
      n = number(v, at);
    if (!between(n, 0, 255) || Math.floor(n) !== n) fail(at, 'expected an integer in [0,255]');
    return n;
  });
  return [channels[0], channels[1], channels[2]];
}
function rectangle(
  parent: Record<string, unknown>,
  path: string,
): { x0: number; y0: number; x1: number; y1: number } {
  const list = parent.bounds;
  if (!Array.isArray(list) || list.length !== 4) return fail(path + '.bounds', 'expected four coordinates');
  const values = list.map((v, i) => {
    const n = number(v, path + `.bounds[${i}]`);
    if (!between(n, -8, 16)) fail(path + '.bounds', 'coordinates must be within [-8,16]');
    return f32(n);
  });
  return { x0: values[0], y0: values[1], x1: values[2], y1: values[3] };
}
function enumeration(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  names: string[],
  initial = 0,
  required = false,
): number {
  if (!(key in parent) && !required) return initial;
  const text = parent[key],
    i = typeof text === 'string' ? names.indexOf(text) : -1;
  return i < 0 ? fail(path + '.' + key, 'unknown enum value') : i;
}
function text(parent: Record<string, unknown>, key: string): string {
  return typeof parent[key] === 'string' ? parent[key] : fail(key, 'expected a string');
}
export function validateBuildingAsset(asset: BuildingAsset): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(asset.id)) fail('id', 'expected [a-z][a-z0-9-]{0,63}');
  const bytes = new TextEncoder().encode(asset.name);
  if (!bytes.length || bytes.length > 96 || !Array.from(bytes).some((c) => c > 32))
    fail('name', 'expected 1–96 UTF-8 bytes with non-space text');
  if (
    /[\x00-\x1f\x7f]/u.test(asset.name) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(asset.name)
  )
    fail('name', 'invalid UTF-8 or control character');
  if (!between(asset.footprint, 0.25, 8)) fail('footprint', 'expected a finite number in [0.25,8]');
  if (!asset.variants.length || asset.variants.length > 32) fail('variants', 'expected 1–32 variants');
  for (let v = 0; v < asset.variants.length; v++) {
    const model = asset.variants[v],
      path = `variants[${v}]`;
    if (
      model.blocks.length > 64 ||
      model.patches.length > 32 ||
      (!model.blocks.length && !model.patches.length)
    )
      fail(path, 'expected 1–96 primitives, at most 64 blocks and 32 patches');
    let faces = 0;
    for (let i = 0; i < model.patches.length; i++) {
      const p = model.patches[i],
        at = path + `.patches[${i}]`;
      bounds(p, at + '.bounds');
      if (!between(p.delay, 0, 120)) fail(at + '.delay', 'expected a finite number in [0,120]');
      if (p.furrows < 0 || p.furrows > 32) fail(at + '.furrows', 'expected an integer in [0,32]');
      faces += 1 + p.furrows;
    }
    for (let i = 0; i < model.blocks.length; i++) {
      const b = model.blocks[i],
        at = path + `.blocks[${i}]`;
      bounds(b, at + '.bounds');
      for (const key of ['base', 'wall', 'roof'] as const)
        if (!between(b[key], 0, 256)) fail(at + '.' + key, 'expected a finite number in [0,256]');
      if (f32(f32(b.base + b.wall) + b.roof) > 512) fail(at, 'combined height exceeds 512');
      if (!between(b.delay, 0, 120)) fail(at + '.delay', 'expected a finite number in [0,120]');
      if (b.windows < 0 || b.windows > 8) fail(at + '.windows', 'expected an integer in [0,8]');
      if (b.shape >>> 0 > RoofShape.Pyramid) fail(at + '.shape', 'unknown enum value');
      if (b.trim >>> 0 > Trim.Stakes) fail(at + '.trim', 'unknown enum value');
      if (b.ornament >>> 0 > Ornament.Crystal) fail(at + '.ornament', 'unknown enum value');
      faces +=
        2 +
        (b.shape === RoofShape.Flat ? 1 : b.shape === RoofShape.Pyramid ? 4 : 2) +
        b.windows * 2 +
        Number(b.door);
      if (b.trim === Trim.Timber) faces += 8;
      if (b.ornament === Ornament.Banner) faces += 2;
      if (b.ornament === Ornament.Crystal) faces += 3;
      if (b.shape === RoofShape.Flat && (b.trim === Trim.Stakes || b.trim === Trim.Crenels)) {
        const pitch = b.trim === Trim.Stakes ? f32(0.12) : f32(0.2);
        faces +=
          2 * Math.max(2, Math.trunc(f32(f32(b.x1 - b.x0) / pitch))) +
          2 * Math.max(2, Math.trunc(f32(f32(b.y1 - b.y0) / pitch)));
      }
    }
    if (faces > 2048) fail(path, 'decoration expansion exceeds 2048 faces');
  }
}
export function decodeBuildingAsset(source: string): BuildingAsset {
  const root = fields(parseJson(source), 'asset', [
    'format',
    'version',
    'id',
    'name',
    'footprint',
    'variants',
  ]);
  if (root.format !== 'building-asset') fail('format', 'expected building-asset');
  if (root.version !== 1) fail('version', 'expected integer 1');
  const asset: BuildingAsset = {
      id: text(root, 'id'),
      name: text(root, 'name'),
      footprint: scalar(root, 'footprint', 'asset', 1, true),
      variants: [],
    },
    variants = root.variants;
  if (!Array.isArray(variants) || !variants.length || variants.length > 32)
    return fail('variants', 'expected 1–32 variants');
  for (let v = 0; v < variants.length; v++) {
    const path = `variants[${v}]`,
      variant = fields(variants[v], path, ['blocks', 'patches']),
      blocks = variant.blocks,
      patches = variant.patches;
    if (!Array.isArray(blocks) || blocks.length > 64)
      return fail(path + '.blocks', 'expected an array of at most 64 blocks');
    if (!Array.isArray(patches) || patches.length > 32)
      return fail(path + '.patches', 'expected an array of at most 32 patches');
    const model: Model = { patches: [], blocks: [] };
    for (let i = 0; i < patches.length; i++) {
      const at = path + `.patches[${i}]`,
        value = fields(patches[i], at, ['bounds', 'color', 'furrows', 'furrow', 'delay']),
        p: Patch = {
          ...rectangle(value, at),
          color: rgb(value, 'color', at, [0, 0, 0], true),
          furrow: rgb(value, 'furrow', at),
          furrows: integer(value, 'furrows', at, 0, 0, 32),
          delay: scalar(value, 'delay', at),
        };
      model.patches.push(p);
    }
    for (let i = 0; i < blocks.length; i++) {
      const at = path + `.blocks[${i}]`,
        value = fields(blocks[i], at, [
          'bounds',
          'wall',
          'roof',
          'shape',
          'wallLit',
          'wallShade',
          'roofLit',
          'roofShade',
          'base',
          'delay',
          'windows',
          'door',
          'trim',
          'glass',
          'ornament',
          'accent',
        ]);
      const b: Block = {
        ...rectangle(value, at),
        wall: scalar(value, 'wall', at, 0, true),
        roof: scalar(value, 'roof', at, 0, true),
        base: scalar(value, 'base', at),
        delay: scalar(value, 'delay', at),
        windows: integer(value, 'windows', at, 0, 0, 8),
        shape: enumeration(value, 'shape', at, shapes, 0, true),
        trim: enumeration(value, 'trim', at, trims),
        ornament: enumeration(value, 'ornament', at, ornaments),
        wallLit: rgb(value, 'wallLit', at, [0, 0, 0], true),
        wallShade: rgb(value, 'wallShade', at, [0, 0, 0], true),
        roofLit: rgb(value, 'roofLit', at, [0, 0, 0], true),
        roofShade: rgb(value, 'roofShade', at, [0, 0, 0], true),
        glass: rgb(value, 'glass', at, [232, 162, 72]),
        accent: rgb(value, 'accent', at, [156, 40, 46]),
        door: false,
        doorFacing: 0,
      };
      if ('door' in value) {
        if (typeof value.door !== 'boolean') fail(at + '.door', 'expected a boolean');
        b.door = value.door as boolean;
      }
      const height =
        number(value.wall, at + '.wall') +
        number(value.roof, at + '.roof') +
        ('base' in value ? number(value.base, at + '.base') : 0);
      if (height > 512) fail(at, 'combined height exceeds 512');
      model.blocks.push(b);
    }
    asset.variants.push(model);
  }
  validateBuildingAsset(asset);
  return asset;
}
export function encodeBuildingAsset(asset: BuildingAsset): string {
  validateBuildingAsset(asset);
  const variants = asset.variants.map((model) => ({
    blocks: model.blocks.map((b) => ({
      bounds: [b.x0, b.y0, b.x1, b.y1],
      wall: b.wall,
      roof: b.roof,
      shape: shapes[b.shape],
      wallLit: b.wallLit,
      wallShade: b.wallShade,
      roofLit: b.roofLit,
      roofShade: b.roofShade,
      base: b.base,
      delay: b.delay,
      windows: b.windows,
      door: b.door,
      trim: trims[b.trim],
      glass: b.glass,
      ornament: ornaments[b.ornament],
      accent: b.accent,
    })),
    patches: model.patches.map((p) => ({
      bounds: [p.x0, p.y0, p.x1, p.y1],
      color: p.color,
      furrows: p.furrows,
      furrow: p.furrow,
      delay: p.delay,
    })),
  }));
  return stringifyJson({
    format: 'building-asset',
    version: 1,
    id: asset.id,
    name: asset.name,
    footprint: asset.footprint,
    variants,
  } as unknown as JsonValue);
}
export function buildingVariant(asset: BuildingAsset, seed: number): Model {
  if (!asset.variants.length) throw new Error('building asset has no variants');
  return asset.variants[(seed >>> 0) % asset.variants.length];
}
