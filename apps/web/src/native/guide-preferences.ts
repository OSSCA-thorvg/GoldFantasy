// The player's choices for the first-time guide, kept in the browser like the language choice.

export interface GuidePreferences {
  /** Ease the camera to a new moment when the player is not busy. */
  focus: boolean;
  /** Show a card for a new moment; the guide log fills either way. */
  cards: boolean;
}
const storageKey = 'midgard.guide';
let current: GuidePreferences | null = null;

/** Storage can be missing or blocked (tests, private windows); both stay on then. */
export function guidePreferences(): GuidePreferences {
  if (current) return current;
  current = { focus: true, cards: true };
  try {
    const stored: unknown = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? 'null');
    if (stored && typeof stored === 'object') {
      if ('focus' in stored && typeof stored.focus === 'boolean') current.focus = stored.focus;
      if ('cards' in stored && typeof stored.cards === 'boolean') current.cards = stored.cards;
    }
  } catch {
    // Unreadable storage keeps the defaults.
  }
  return current;
}
export function setGuidePreference(name: keyof GuidePreferences, value: boolean): void {
  const next = guidePreferences();
  next[name] = value;
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(next));
  } catch {
    // The choice still applies for this session.
  }
}
/** Forgets the cached choice so the next read comes from storage again. */
export function reloadGuidePreferences(): void {
  current = null;
}
