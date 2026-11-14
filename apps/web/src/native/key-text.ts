// What a key press is called when it reaches the game, whatever keyboard layout produced it.

/** The game's name for a browser key: lower case, with the native names for space, return and the arrows. */
export const nativeKey = (key: string): string =>
  key === ' '
    ? 'space'
    : key === 'Enter'
      ? 'return'
      : key.startsWith('Arrow')
        ? key.slice(5).toLowerCase()
        : key.toLowerCase();
const letterKey = /^Key([A-Z])$/;
/** True for a letter key by its place on the board, which a non-Latin layout cannot change. */
export const isLetterCode = (code: string): boolean => letterKey.test(code);
/**
 * The text of a key press. Hotkeys are letters, but under a Hangul input method (or any non-Latin
 * layout) the browser reports the Q key as 'ㅂ', or as 'Process' while composing. So outside a text
 * field, a letter key that did not give a Latin letter is named by its physical position instead.
 * A Latin layout keeps the letter it prints, and typing into a text field always keeps the real character.
 */
export function keyText(key: string, code: string, typing: boolean): string {
  const letter = letterKey.exec(code)?.[1];
  return !typing && letter && !/^[a-z]$/i.test(key) ? letter.toLowerCase() : nativeKey(key);
}
