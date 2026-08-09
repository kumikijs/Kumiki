// A name declared twice, everywhere a name can be declared.
//
// Every site had the same shape and the same outcome: an assignment into a map
// or a variable, with no check that the key was free, so the later declaration
// won and the earlier one left no trace. Timer names were the sole exception
// (`E0002`), which made the policy read as deliberate when it was not.
//
// The rule is stated once here, over a list of `(name, position)` pairs, and
// every caller supplies the list its construct produces. What the callers do
// *not* share is where the duplicate can still be seen: an array in the tree
// keeps both, while `app` and `effect` clauses and theme records are assembled
// into a record whose later key overwrites the earlier one, so those are
// recorded by the parser on the way past.

import type { DuplicateName, Pos } from "./ast.ts";

/**
 * The declarations past the first for each name declared more than once, in
 * source order.
 *
 * The *later* one is what gets reported: it is the one to delete, and the
 * earlier one is the declaration the reader meant to keep. Reporting every
 * occurrence past the first (rather than only the second) means a name written
 * three times produces two findings, which is how many edits it takes.
 *
 * Takes the declarations, not the duplicates — filtering happens here and only
 * here, so a caller cannot narrow the list first and leave nothing to find.
 */
export function duplicatesIn(declared: readonly DuplicateName[]): readonly DuplicateName[] {
  const seen = new Set<string>();
  const out: DuplicateName[] = [];
  for (const d of declared) {
    if (seen.has(d.name)) out.push(d);
    else seen.add(d.name);
  }
  return out;
}

/**
 * The `(name, position)` pairs of a construct whose declarations carry the two
 * separately — a record type's fields keep the name beside the type, a route
 * keeps the pattern beside the tile.
 */
export function namesOf<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  posOf: (item: T) => Pos,
): readonly DuplicateName[] {
  return items.map((i) => ({ name: nameOf(i), pos: posOf(i) }));
}
