// The did-you-mean half of every diagnostic in this repo: the distance, and the
// ranking built on it.
//
// Both lived twice — in the compiler and in `kumiki fix` — character for
// character including their comments, so a change to one was a change to half
// the suggestions. They live here because this is the package everything else
// depends on: `@kumikijs/compiler` re-exports them, `@kumikijs/cli` imports
// that, and the verification tiers' unknown-reducer message reaches them
// without the runtime depending on the compiler (which depends on the runtime).
//
// Pure — no DOM, no Node, and reachable on its own through the
// `@kumikijs/runtime/text-distance` subpath, so a compiler that wants one
// function does not evaluate the whole runtime module graph to get it.

/**
 * Levenshtein edit distance.
 *
 * The threshold is deliberately not here: what counts as "close enough" belongs
 * to the candidate set being searched. {@link nearestName} carries the rule for
 * a set of user-written top-level names; `nearestSection` in the compiler
 * carries a different one, because a closed three-word vocabulary can afford an
 * abbreviation rule and can refuse a tie by printing the whole set instead.
 */
export function levenshtein(a: string, b: string): number {
  const n = b.length;
  // Rolling single-row DP — `prev` holds the previous row's distances.
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

/**
 * The closest candidate to `written`, or `null` when none is close enough — a
 * suggestion that is not the name the author meant sends the repair at the
 * wrong one, which is worse than no suggestion at all.
 *
 * Close enough is at most 2 edits, or at most a quarter of the written name's
 * length, whichever is more forgiving: a long name mistyped in three places is
 * still recognisable, a three-character one mistyped twice is not.
 *
 * The candidate set is user-written top-level names — the definitions in a
 * program for `kumiki fix`, the reducers in an app shape for the verification
 * tiers. Sharing the rule and not just the metric is the point: the metric was
 * never the half that drifts.
 *
 * A candidate equal to `written` is skipped, so a caller that searches a set
 * the name is already in still gets a genuine alternative rather than an echo.
 * A tie goes to the first candidate met, which is what `kumiki fix` has always
 * done; `nearestSection`'s opposite choice (refuse the tie, print the whole
 * vocabulary) is available to it because its vocabulary is three words long and
 * printable, and a program's definitions are not.
 */
export function nearestName(written: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    const d = levenshtein(written, cand);
    if (d === 0) continue;
    if (d < bestScore) {
      bestScore = d;
      best = cand;
    }
  }
  if (best === null) return null;
  return bestScore <= 2 || bestScore <= Math.ceil(written.length * 0.25) ? best : null;
}
