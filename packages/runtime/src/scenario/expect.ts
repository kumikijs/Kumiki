export function readDottedPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Partial structural match: every key/element in `want` must be present in `got`. */
export function partialMatch(want: unknown, got: unknown): boolean {
  if (want === null || typeof want !== "object") return want === got;
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return false;
    return want.every((w, i) => partialMatch(w, got[i]));
  }
  if (got === null || typeof got !== "object") return false;
  const g = got as Record<string, unknown>;
  return Object.entries(want as Record<string, unknown>).every(([k, w]) => partialMatch(w, g[k]));
}

export function showValue(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** One failure line per `expected` entry (slot name or dotted path) that `state` does not match. */
export function stateMismatches(
  expected: Record<string, unknown>,
  state: Record<string, unknown>,
): string[] {
  const failures: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = readDottedPath(state, key);
    if (!partialMatch(want, got)) {
      failures.push(`state ${key}: expected ${showValue(want)}, got ${showValue(got)}`);
    }
  }
  return failures;
}

/** One failure line per substring `text` lacks or carries against the expectation; `what` names the text. */
export function textMismatches(
  expect: { domIncludes?: string[]; domExcludes?: string[] },
  text: string,
  what: string,
): string[] {
  const failures: string[] = [];
  for (const s of expect.domIncludes ?? []) {
    if (!text.includes(s)) failures.push(`${what} should include "${s}"`);
  }
  for (const s of expect.domExcludes ?? []) {
    if (text.includes(s)) failures.push(`${what} should NOT include "${s}"`);
  }
  return failures;
}
