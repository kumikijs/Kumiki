/**
 * Levenshtein edit distance, the one every did-you-mean in this repo measures
 * with. It lived twice — in the compiler and in `kumiki fix` — character for
 * character including its comment, so a change to one was a change to half the
 * suggestions. It lives here because this is the package everything else
 * depends on: `@kumikijs/compiler` re-exports it, `@kumikijs/cli` imports that,
 * and the scenario runner's unknown-reducer message reaches it without the
 * runtime depending on the compiler (which depends on the runtime).
 *
 * Pure — no DOM, no Node. It is bundled only where it is used: `scenario.ts` is
 * its one runtime caller, so the granular `dist/modules/*` build never sees it.
 *
 * The threshold is deliberately not here: what counts as "close enough"
 * belongs to the candidate set being searched, which is a closed vocabulary of
 * three words in one caller and every definition in a program in the other.
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
