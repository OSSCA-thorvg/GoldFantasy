import type { WebCanvas } from './types';
import { koreanFont } from '../../localization/src/index';

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
}
export type NativeFontMetrics = Readonly<Record<string, FontMetrics>>;

/** Read the original TTF tables instead of substituting browser font measurements. */
export function parseFontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12) throw new Error('Truncated TrueType font header.');
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (at + 16 > bytes.length) throw new Error('Truncated TrueType table directory.');
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8),
      length = view.getUint32(at + 12);
    if (offset + length > bytes.length) throw new Error('Truncated TrueType table.');
    tables.set(tag, { offset, length });
  }
  const head = tables.get('head'),
    hhea = tables.get('hhea');
  if (!head || head.length < 20 || !hhea || hhea.length < 10)
    throw new Error('Font has no TrueType metrics.');
  const unitsPerEm = view.getUint16(head.offset + 18);
  if (!unitsPerEm) throw new Error('Font has an invalid em size.');
  return {
    unitsPerEm,
    ascent: view.getInt16(hhea.offset + 4),
    descent: view.getInt16(hhea.offset + 6),
    lineGap: view.getInt16(hhea.offset + 8),
  };
}

export async function loadNativeFonts(
  tvg: WebCanvas,
  base = `${import.meta.env?.BASE_URL ?? '/'}assets/native-fonts`,
): Promise<NativeFontMetrics> {
  const metrics: Record<string, FontMetrics> = {};
  await Promise.all([
    ...['DejaVuSans', 'DejaVuSans-Bold'].map(async (name) => {
      const response = await fetch(`${base}/${name}.ttf`);
      if (!response.ok) throw new Error(`Cannot load native font ${name}: ${response.status}.`);
      const data = new Uint8Array(await response.arrayBuffer());
      metrics[name] = parseFontMetrics(data);
      tvg.Font.load(name, data);
    }),
    loadCombatFont(tvg, base, metrics),
  ]);
  loaded.set(metrics, { metrics, base, extra: new Map() });
  return metrics;
}

/** Heavy Cinzel instance for combat numbers (OFL, see public/licenses/Cinzel-OFL.txt). */
export const combatFontName = 'Cinzel-Black';
const combatFaces = new WeakSet<object>();
/** The combat face once loaded into this ThorVG instance, else the bold UI face. */
export function combatFace(tvg: object): string {
  return combatFaces.has(tvg) ? combatFontName : 'DejaVuSans-Bold';
}
// Optional: a missing or broken file only falls back to the UI face.
async function loadCombatFont(tvg: WebCanvas, base: string, metrics: Record<string, FontMetrics>) {
  try {
    const response = await fetch(`${base}/${combatFontName}.ttf`);
    if (!response.ok) return;
    const data = new Uint8Array(await response.arrayBuffer());
    metrics[combatFontName] = parseFontMetrics(data);
    tvg.Font.load(combatFontName, data);
    combatFaces.add(tvg);
  } catch {
    // Keep the fallback face.
  }
}

const loaded = new WeakMap<
  NativeFontMetrics,
  { metrics: Record<string, FontMetrics>; base: string; extra: Map<string, Promise<void>> }
>();
/** Fetched only when Korean is chosen, so English players never download it. */
export function loadKoreanFont(tvg: WebCanvas, fonts: NativeFontMetrics): Promise<void> {
  const set = loaded.get(fonts);
  if (!set) return Promise.reject(new Error('Native fonts are not loaded.'));
  let pending = set.extra.get(koreanFont);
  if (!pending) {
    pending = Promise.all(
      [koreanFont, `${koreanFont}-Bold`].map(async (name) => {
        const response = await fetch(`${set.base}/${name}.ttf`);
        if (!response.ok) throw new Error(`Cannot load native font ${name}: ${response.status}.`);
        const data = new Uint8Array(await response.arrayBuffer());
        set.metrics[name] = parseFontMetrics(data);
        tvg.Font.load(name, data);
      }),
    ).then(() => undefined);
    pending.catch(() => set.extra.delete(koreanFont));
    set.extra.set(koreanFont, pending);
  }
  return pending;
}
