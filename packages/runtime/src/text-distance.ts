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
