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
 * to the candidate set being searched. {@link nearestNames} carries the rule for
 * the names a program writes; `nearestSection` in the compiler carries a
 * different one, because a closed three-word vocabulary can afford an
 * abbreviation rule, and answers a tie by printing the whole set.
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
 * The candidates closest to `written`, sorted, or none when none is close
 * enough — a suggestion that is not the name the author meant sends the repair
 * at the wrong one, which is worse than no suggestion at all.
 *
 * Close enough is at most 2 edits, or at most a quarter of the written name's
 * length, whichever is more forgiving: a long name mistyped in three places is
 * still recognisable, a three-character one mistyped twice is not.
 *
 * At the same distance, a candidate in `preferred` outranks one that is not.
 * That is how a caller searching a program's own names beside built-in ones
 * says which half the author more likely meant: `Filtre` is two edits from the
 * declared `Filter` and from the built-in `File`, and the declared type is the
 * one being written about. Distance still comes first — a built-in one edit
 * away beats a declared name two edits away.
 *
 * More than one candidate left is a tie, and every tied candidate is answered:
 * `count` is one edit from `countA` and from `countB`, and nothing in the
 * distance says which the author meant. Keeping whichever the candidates
 * listed first would let the order of a program's definitions pick the name,
 * so the answer carries them all in sorted order and each caller decides what
 * a tie means to it — a repair that writes a name writes none, a message that
 * prints one prints them all. A name listed twice is one candidate, not a tie.
 *
 * The candidates are names a program can write: its definitions (and, where a
 * namespace has them, the built-in names beside them) for `kumiki fix`, the
 * reducers in an app shape for the verification tiers. Sharing the rule and
 * not just the metric is the point: the metric was never the half that drifts.
 *
 * A candidate equal to `written` is skipped, so a caller that searches a set
 * the name is already in still gets a genuine alternative rather than an echo.
 */
export function nearestNames(
  written: string,
  candidates: Iterable<string>,
  preferred: Iterable<string> = [],
): string[] {
  const prefer = new Set(preferred);
  let best = new Set<string>();
  // Lower is better on both: edits, then 0 for a preferred name and 1 otherwise.
  let bestScore = Number.POSITIVE_INFINITY;
  let bestTier = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    const d = levenshtein(written, cand);
    if (d === 0) continue;
    const tier = prefer.has(cand) ? 0 : 1;
    if (d > bestScore || (d === bestScore && tier > bestTier)) continue;
    if (d < bestScore || tier < bestTier) {
      bestScore = d;
      bestTier = tier;
      best = new Set();
    }
    best.add(cand);
  }
  const close = bestScore <= 2 || bestScore <= Math.ceil(written.length * 0.25);
  return close ? [...best].sort() : [];
}

/**
 * The one candidate closest to `written`, or `null` when none is close enough
 * or several are equally close — {@link nearestNames} for a caller that can
 * act on one name only, so a tie is no answer rather than the first of it.
 */
export function nearestName(
  written: string,
  candidates: Iterable<string>,
  preferred: Iterable<string> = [],
): string | null {
  const near = nearestNames(written, candidates, preferred);
  return near.length === 1 ? near[0]! : null;
}
