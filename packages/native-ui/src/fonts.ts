import type { WebCanvas } from './types';

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
  await Promise.all(
    ['DejaVuSans', 'DejaVuSans-Bold'].map(async (name) => {
      const response = await fetch(`${base}/${name}.ttf`);
      if (!response.ok) throw new Error(`Cannot load native font ${name}: ${response.status}.`);
      const data = new Uint8Array(await response.arrayBuffer());
      metrics[name] = parseFontMetrics(data);
      tvg.Font.load(name, data);
    }),
  );
  return metrics;
}
