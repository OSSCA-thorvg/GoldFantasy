import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../../packages/native-audio/src/data/audio-manifest.json';
import { hasHangul, locale, setLocale, translate } from '../../packages/localization/src/index';
import { captionShown } from '../../apps/web/src/native/game-speech';

const captions = (value: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) for (const item of value) captions(item, found);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value))
      if (key === 'caption' && typeof item === 'string' && item) found.add(item);
      else captions(item, found);
  return found;
};

describe('speech bubbles in Korean', () => {
  const before = locale();
  afterEach(() => setLocale(before));
  it('has a Korean line for every recorded voice caption', () => {
    setLocale('KR');
    for (const caption of captions(manifest)) expect(hasHangul(translate(caption)), caption).toBe(true);
  });
  it('shows the spoken share of the translated line, not the untranslated beginning of the English one', () => {
    setLocale('KR');
    const line = 'Uhk! ... Ak! ... Ut! ... Nk!',
      whole = translate(line);
    expect(captionShown(line, line)).toBe(whole);
    const half = captionShown(line.slice(0, 12), line);
    expect(hasHangul(half)).toBe(true);
    expect(whole.startsWith(half)).toBe(true);
    expect(half.length).toBeLessThan(whole.length);
    // A single spoken letter still shows something.
    expect(captionShown('Y', 'Yes?').length).toBeGreaterThan(0);
  });
  it('leaves English as it is spoken', () => {
    setLocale('ENG');
    expect(captionShown('Ye', 'Yes?')).toBe('Ye');
  });
});
