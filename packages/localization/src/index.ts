import { korean } from './korean';
import { locale } from './locale';

export * from './locale';
export type { Phrases } from './phrases';
export { PhraseBook } from './phrase-book';

/** Text for the chosen language. English is the source and passes through untouched. */
export function translate(text: string): string {
  return locale() === 'KR' ? korean.translate(text) : text;
}
export const untranslated = (): string[] => korean.missing();
const hangul = /[ᄀ-ᇿ㄰-㆏가-힯]/;
export const hasHangul = (text: string): boolean => hangul.test(text);
export const koreanFont = 'NotoSansKR';
