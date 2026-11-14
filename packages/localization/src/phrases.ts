/**
 * One language's phrase table. A key is the English text exactly as the game produces it.
 * `{0}`, `{1}`... in a key stand for the changing parts, numbered in the order they appear;
 * the value may place them in any order. Each changing part is translated on its own.
 */
export type Phrases = Readonly<Record<string, string>>;
