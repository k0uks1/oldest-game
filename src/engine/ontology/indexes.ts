import { levenshtein } from "../text.ts";

/**
 * Character trie mapping keys to values. Used for
 *  - compound suffixes (insert reversed aliases → "which aliases end this word?")
 *  - adjective stems ("which stems start this word?")
 * Lookups are O(word length), independent of vocabulary size.
 */
export class Trie<V> {
  private readonly root: TrieNode<V> = { next: new Map(), values: [] };

  insert(key: string, value: V): void {
    let node = this.root;
    for (const ch of key) {
      let child = node.next.get(ch);
      if (child === undefined) {
        child = { next: new Map(), values: [] };
        node.next.set(ch, child);
      }
      node = child;
    }
    node.values.push(value);
  }

  /** All keys that are prefixes of `word`, longest first, with their length. */
  prefixesOf(word: string): { length: number; values: readonly V[] }[] {
    const out: { length: number; values: readonly V[] }[] = [];
    let node: TrieNode<V> | undefined = this.root;
    let depth = 0;
    for (const ch of word) {
      node = node.next.get(ch);
      if (node === undefined) break;
      depth++;
      if (node.values.length > 0) out.push({ length: depth, values: node.values });
    }
    return out.reverse();
  }
}

interface TrieNode<V> {
  readonly next: Map<string, TrieNode<V>>;
  readonly values: V[];
}

/**
 * Trigram index for typo-tolerant lookup over large vocabularies:
 * only strings sharing trigrams with the query are compared with Levenshtein.
 */
export class TrigramIndex<V> {
  private readonly grams = new Map<string, number[]>();
  private readonly keys: string[] = [];
  private readonly values: V[] = [];

  add(key: string, value: V): void {
    const id = this.keys.length;
    this.keys.push(key);
    this.values.push(value);
    for (const g of trigrams(key)) {
      const list = this.grams.get(g);
      if (list === undefined) this.grams.set(g, [id]);
      else if (list.at(-1) !== id) list.push(id);
    }
  }

  /** Best matches within `maxDistance`, sorted by distance then key. */
  search(query: string, maxDistance: number, limit = 5): { key: string; value: V; distance: number }[] {
    const counts = new Map<number, number>();
    const qGrams = trigrams(query);
    for (const g of qGrams) {
      for (const id of this.grams.get(g) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // A string within distance d shares at least |grams| - 3d trigrams.
    const minShared = Math.max(1, qGrams.length - 3 * maxDistance);
    const hits: { key: string; value: V; distance: number }[] = [];
    for (const [id, n] of counts) {
      if (n < minShared) continue;
      const key = this.keys[id] ?? "";
      const d = levenshtein(query, key, maxDistance);
      if (d <= maxDistance) hits.push({ key, value: this.values[id] as V, distance: d });
    }
    return hits
      .sort((a, b) => a.distance - b.distance || a.key.length - b.key.length || a.key.localeCompare(b.key))
      .slice(0, limit);
  }
}

function trigrams(s: string): string[] {
  const padded = `  ${s} `;
  const out: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
  return [...new Set(out)];
}
