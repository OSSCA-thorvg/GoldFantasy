import type { Phrases } from './phrases';

interface Pattern {
  match: RegExp;
  /** Capture group index for each `{n}` in the key, by n. */
  value: string;
  weight: number;
}
const placeholder = /\{(\d+)\}/g;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const worded = /[A-Za-z]{2}/,
  hangul = /[\uac00-\ud7af]/;
/** A name, or names joined as a list: every piece is at most two words. */
const nameLike = (text: string): boolean =>
  text.split(/, | \u00b7 |\n/).every((piece) => piece.trim().split(/\s+/).length <= 2);

/** Exact phrases, then patterns from most to least literal text, then piecewise lists. */
export class PhraseBook {
  private readonly exact = new Map<string, string>();
  private readonly patterns: Pattern[] = [];
  private readonly cache = new Map<string, string>();
  private readonly unknown = new Set<string>();

  constructor(...tables: Phrases[]) {
    for (const table of tables)
      for (const [key, value] of Object.entries(table)) {
        if (!placeholder.test(key)) {
          this.exact.set(key, value);
          continue;
        }
        placeholder.lastIndex = 0;
        const order: number[] = [];
        let source = '',
          last = 0,
          literal = 0;
        for (const hit of key.matchAll(placeholder)) {
          const text = key.slice(last, hit.index);
          literal += text.length;
          source += escape(text) + '([\\s\\S]+?)';
          order.push(Number(hit[1]));
          last = hit.index + hit[0].length;
        }
        literal += key.length - last;
        source += escape(key.slice(last));
        // Rewrite `{n}` in the value to the capture that holds it.
        const rewritten = value.replace(placeholder, (_, n: string) => `{${order.indexOf(Number(n))}}`);
        this.patterns.push({ match: new RegExp(`^${source}$`), value: rewritten, weight: literal });
      }
    this.patterns.sort((a, b) => b.weight - a.weight);
  }

  translate(text: string): string {
    if (!text || !worded.test(text)) return text;
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;
    const result = this.resolve(text, 0);
    if (result === undefined && !hangul.test(text)) this.unknown.add(text);
    // Counters and timers make endless distinct strings; start over rather than grow.
    if (this.cache.size > 6000) this.cache.clear();
    this.cache.set(text, result ?? text);
    return result ?? text;
  }
  /** English text that was shown without a translation, for filling the tables. */
  missing(): string[] {
    return [...this.unknown].sort();
  }

  private resolve(text: string, depth: number): string | undefined {
    const direct = this.exact.get(text);
    if (direct !== undefined) return direct;
    if (depth > 4) return undefined;
    const edge = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    if (edge[1] || edge[3]) {
      const inner = this.resolve(edge[2], depth);
      return inner === undefined ? undefined : edge[1] + inner + edge[3];
    }
    for (const joint of ['\n', ' · ', ', ']) {
      if (!text.includes(joint)) continue;
      const pieces = text.split(joint),
        done = pieces.map((piece) => (worded.test(piece) ? this.resolve(piece, depth + 1) : piece));
      // Lists go first so a pattern cannot swallow several items as one part.
      // A list is only rewritten when every worded piece is known: no half-translated lines.
      if (done.every((piece) => piece !== undefined)) return done.join(joint);
    }
    for (const pattern of this.patterns) {
      const hit = pattern.match.exec(text);
      if (!hit) continue;
      const parts = hit.slice(1).map((piece) => (worded.test(piece) ? this.resolve(piece, depth + 1) : piece));
      // A long unknown capture is a different English sentence, not a name (or a list of names): leave it whole.
      if (parts.some((piece, i) => piece === undefined && !nameLike(hit[i + 1]))) continue;
      return pattern.value.replace(placeholder, (_, n: string) => parts[Number(n)] ?? hit[Number(n) + 1] ?? '');
    }
    return undefined;
  }
}
