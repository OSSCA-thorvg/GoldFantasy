export const locales = ['ENG', 'KR'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ENG';
export const isLocale = (value: unknown): value is Locale => locales.some((name) => name === value);

const storageKey = 'midgard.locale';
let current: Locale = defaultLocale,
  revision = 0;
const listeners = new Set<(locale: Locale) => void>();

export const locale = (): Locale => current;
/** Bumps on every change so cached text layouts know to rebuild. */
export const localeRevision = (): number => revision;
export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  ++revision;
  for (const listener of listeners) listener(next);
}
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Storage can be missing or blocked (tests, private windows); the default then stands. */
export function storedLocale(): Locale {
  try {
    const value = globalThis.localStorage?.getItem(storageKey);
    return isLocale(value) ? value : defaultLocale;
  } catch {
    return defaultLocale;
  }
}
export function storeLocale(value: Locale): void {
  try {
    globalThis.localStorage?.setItem(storageKey, value);
  } catch {
    // The choice still applies for this session.
  }
}
