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
 * Every candidate tied at the best distance, sorted, so the order of a program's definitions
 * never picks the name; each caller decides what a tie means to it. At the same distance a
 * `preferred` candidate (a program's own name beside built-in ones) outranks the rest.
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

/** The one closest candidate, or `null` when none is close enough or several tie. */
export function nearestName(
  written: string,
  candidates: Iterable<string>,
  preferred: Iterable<string> = [],
): string | null {
  const near = nearestNames(written, candidates, preferred);
  return near.length === 1 ? near[0]! : null;
}
