/**
 * Sparse, immutable set of tag indices: a sorted `Uint32Array`.
 *
 * With tens of thousands of tags a dense bitset per form/tag would cost
 * kilobytes each; real forms carry dozens of tags, so sorted index arrays are
 * both smaller and fast (binary search / linear merge).
 */
export type TagSet = Uint32Array;

export const EMPTY: TagSet = new Uint32Array(0);

export function fromIterable(values: Iterable<number>): TagSet {
  const arr = Uint32Array.from(new Set(values));
  arr.sort();
  return arr;
}

export function has(set: TagSet, value: number): boolean {
  let lo = 0;
  let hi = set.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = set[mid] ?? 0;
    if (v === value) return true;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Elements of `a` that are in `b` (linear merge, both sorted). */
export function intersection(a: TagSet, b: TagSet): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] ?? 0;
    const y = b[j] ?? 0;
    if (x === y) {
      out.push(x);
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return out;
}

export function intersects(a: TagSet, b: TagSet): boolean {
  // Probe the smaller set into the larger one when sizes differ a lot.
  if (a.length * 8 < b.length) return a.some((x) => has(b, x));
  if (b.length * 8 < a.length) return b.some((x) => has(a, x));
  return intersection(a, b).length > 0;
}

export function union(sets: Iterable<TagSet>): TagSet {
  const all: number[] = [];
  for (const s of sets) for (const v of s) all.push(v);
  return fromIterable(all);
}

export function difference(a: TagSet, remove: TagSet): TagSet {
  if (remove.length === 0) return a;
  return Uint32Array.from(a.filter((x) => !has(remove, x)));
}
