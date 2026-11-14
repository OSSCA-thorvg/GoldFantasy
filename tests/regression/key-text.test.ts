import { describe, expect, it } from 'vitest';
import { isLetterCode, keyText, nativeKey } from '../../apps/web/src/native/key-text';

describe('hotkeys on any keyboard layout', () => {
  it('names a letter key by its place on the board when the layout gives no Latin letter', () => {
    // A Hangul input method: Q prints a jamo, or reports Process while composing.
    expect(keyText('ㅂ', 'KeyQ', false)).toBe('q');
    expect(keyText('Process', 'KeyW', false)).toBe('w');
    expect(keyText('ㅁ', 'KeyA', false)).toBe('a');
    // Cyrillic, with Shift.
    expect(keyText('Й', 'KeyQ', false)).toBe('q');
    expect(isLetterCode('KeyQ')).toBe(true);
    expect(isLetterCode('Digit1')).toBe(false);
    expect(isLetterCode('')).toBe(false);
  });
  it('keeps the letter a Latin layout prints, wherever that key sits', () => {
    expect(keyText('q', 'KeyQ', false)).toBe('q');
    expect(keyText('Q', 'KeyQ', false)).toBe('q');
    // AZERTY: the key in Q's place prints A, and A is what its cap says.
    expect(keyText('a', 'KeyQ', false)).toBe('a');
  });
  it('leaves digits, function keys, symbols and named keys as they were', () => {
    expect(keyText('1', 'Digit1', false)).toBe('1');
    expect(keyText('!', 'Digit1', false)).toBe('!');
    expect(keyText('F2', 'F2', false)).toBe('f2');
    expect(keyText('`', 'Backquote', false)).toBe('`');
    expect(keyText(' ', 'Space', false)).toBe('space');
    expect(keyText('Enter', 'Enter', false)).toBe('return');
    expect(keyText('ArrowLeft', 'ArrowLeft', false)).toBe('left');
    expect(keyText('Escape', 'Escape', false)).toBe(nativeKey('Escape'));
  });
  it('keeps the real character while a text field is taking input', () => {
    expect(keyText('ㅂ', 'KeyQ', true)).toBe('ㅂ');
    expect(keyText('Process', 'KeyW', true)).toBe('process');
  });
});
