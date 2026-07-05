// kumiki fix — propose auto-patches for repairable typecheck errors.

import { readFileSync, writeFileSync } from "node:fs";
import type { KumikiError } from "@kumikijs/compiler";
import { check, lex, parse } from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { testFile } from "./smoke.ts";
import { listDefs, load, type Store } from "./store.ts";

export type AutoPatch = {
  code: string;
  message: string;
  /** Free-form description of the fix to be applied. */
  description: string;
  apply: (text: string) => string;
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Rolling single-row DP — `prev` holds the previous row's distances.
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suggestName(store: Store, missing: string): string | null {
  const all = listDefs(store).map((e) => e.name);
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const cand of all) {
    const d = levenshtein(missing, cand);
    if (d < bestScore) {
      bestScore = d;
      best = cand;
    }
  }
  // Accept the suggestion only if the names are close enough (≤ 2 edits or ≤ 25%).
  if (best === null) return null;
  if (bestScore <= 2 || bestScore <= Math.ceil(missing.length * 0.25)) return best;
  return null;
}

export function planFixes(store: Store, errors: KumikiError[]): AutoPatch[] {
  const patches: AutoPatch[] = [];
  for (const err of errors) {
    if (
      err.code === "E0103" ||
      err.code === "E0105" ||
      err.code === "E0102" ||
      err.code === "E0104"
    ) {
      const match = /"([^"]+)"/.exec(err.message);
      if (!match) continue;
      const missing = match[1]!;
      const suggested = suggestName(store, missing);
      if (!suggested) continue;
      patches.push({
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => {
          const lines = text.split(/\r?\n/);
          const idx = err.pos.line - 1;
          const line = lines[idx] ?? "";
          const re = new RegExp(`\\b${escapeRegex(missing)}\\b`);
          lines[idx] = line.replace(re, suggested);
          return lines.join("\n");
        },
      });
    }
    if (err.code === "E0001") {
      patches.push({
        code: err.code,
        message: err.message,
        description: `add "/404" -> NotFound to app.routes (you must define a NotFound tile)`,
        apply: (text: string) => {
          // Append a NotFound tile + extend routes
          const need = `\ntile NotFound = page(heading("404"))\n`;
          // Inject "/404" -> NotFound before the closing brace of `routes = { ... }`.
          const re = /(routes\s*=\s*\{)([^}]*)(\})/;
          const replaced = text.replace(re, (_m, open: string, body: string, close: string) => {
            if (body.includes('"/404"')) return `${open}${body}${close}`;
            const trimmed = body.trimEnd();
            const sep = trimmed.endsWith(",") || trimmed.endsWith("{") ? "" : ",";
            return `${open}${body}${sep} "/404" -> NotFound ${close}`;
          });
          return need + replaced;
        },
      });
    }
  }
  return patches;
}

/**
 * Pure planner: read + typecheck + planFixes (filtered by `onlyCode` when set).
 * No I/O beyond reading the file. Returned `patches` is empty when nothing is
 * repairable; `errors` carries the raw diagnostics either way so the caller can
 * distinguish "clean file" from "errors but nothing to auto-fix".
 */
export function planFix(
  path: string,
  onlyCode: string | undefined,
  capabilities: string[] = [],
): FixPlan {
  const store = load(path);
  const errors = check(store.program, { capabilities });
  if (errors.length === 0) return { errors, patches: [] };
  const all = planFixes(store, errors);
  const patches = onlyCode ? all.filter((p) => p.code === onlyCode) : all;
  return { errors, patches };
}

export type FixPlan = {
  /** Raw typecheck errors on `path`. Empty when the file is clean. */
  errors: KumikiError[];
  /** Repairable subset, filtered by `onlyCode` when the caller passed it. */
  patches: AutoPatch[];
};

/**
 * Apply the planned patches to `path`, re-typecheck the result, and return
 * before/after source plus the residual diagnostic set. `parseError` is set
 * only when the composed patches produced source the lexer/parser cannot
 * accept — the file has already been written in that case; surfacing the
 * error to the caller is preferred to throwing, because rolling back would
 * lose the artefact that shows *why* the composed patch was bad. Callers
 * that need a dry preview should use `planFix` and apply `patches[i].apply`
 * themselves.
 */
export function applyFixPlan(
  path: string,
  onlyCode: string | undefined,
  capabilities: string[] = [],
): FixApplyResult {
  const plan = planFix(path, onlyCode, capabilities);
  const before = readFileSync(path, "utf8");
  if (plan.patches.length === 0) {
    return { applied: 0, before, after: before, remaining: plan.errors };
  }
  let after = before;
  for (const p of plan.patches) after = p.apply(after);
  writeFileSync(path, after);
  try {
    const next = parse(lex(after));
    const remaining = check(next, { capabilities });
    return { applied: plan.patches.length, before, after, remaining };
  } catch (e) {
    // The composed patches produced unparseable source (already on disk).
    // Emit a synthetic parse-error diagnostic so `remaining.length === 0 ⇔
    // file is clean` holds; callers that read only `remaining` won't mistake
    // a broken file for a fixed one. `parseError` still carries the raw
    // message for surfacing.
    const message = e instanceof Error ? e.message : String(e);
    const pe = e as { pos?: { line: number; col: number } };
    const synthetic: KumikiError = {
      code: "E0000",
      kind: "parse-error",
      message,
      pos: { line: pe.pos?.line ?? 0, col: pe.pos?.col ?? 0 },
    };
    return {
      applied: plan.patches.length,
      before,
      after,
      remaining: [synthetic],
      parseError: message,
    };
  }
}

export type FixApplyResult = {
  /** Number of patches actually applied. `0` when the file was already clean or nothing was auto-fixable. */
  applied: number;
  /** Source before writing. Equal to `after` when `applied === 0`. */
  before: string;
  /** Source after writing (already on disk). */
  after: string;
  /**
   * Residual diagnostics after the write. Empty ⇔ file is clean. When the
   * write produced unparseable source, this contains a synthetic `E0000`
   * parse-error so the empty-⇔-clean invariant holds without callers needing
   * to inspect `parseError` first.
   */
  remaining: KumikiError[];
  /**
   * Raw parser message when the composed patches broke syntax. Duplicated by
   * the `E0000` entry in `remaining`; kept as a convenience field for
   * callers rendering a human message.
   */
  parseError?: string;
};

export function fixCmd(
  path: string,
  apply: boolean,
  onlyCode?: string,
  capabilities: string[] = [],
): void {
  if (!apply) {
    const { errors, patches } = planFix(path, onlyCode, capabilities);
    if (errors.length === 0) {
      console.log("no errors");
      return;
    }
    if (patches.length === 0) {
      console.log("(no auto-patches available)");
      for (const e of errors) console.error(`${e.code} ${e.message}`);
      return;
    }
    for (const p of patches) {
      console.log(`${p.code} ${p.message}`);
      console.log(`  fix: ${p.description}`);
    }
    return;
  }
  const result = applyFixPlan(path, onlyCode, capabilities);
  if (result.applied === 0) {
    if (result.remaining.length === 0) {
      console.log("no errors");
      return;
    }
    console.log("(no auto-patches available)");
    for (const e of result.remaining) console.error(`${e.code} ${e.message}`);
    return;
  }
  if (result.parseError) {
    console.error(`fixes broke the file: ${result.parseError}`);
    return;
  }
  if (result.remaining.length === 0)
    console.log(`applied ${result.applied} fix(es) — file now clean`);
  else
    console.log(`applied ${result.applied} fix(es) — ${result.remaining.length} error(s) remain`);
}

// ----- `kumiki fix --auto-patch <test-name>` (M4b) -----
//
// Repair a `.kumiki` file from a failing `test` definition. Two tiers:
//   1. compile-blocked — the file doesn't typecheck, so the test can't run;
//      reuse `planFixes` to clear the blocking errors first.
//   2. behavioral — the file compiles but the test fails; apply a deterministic
//      literal repair when one is provable (see `planTestPatch`), else report.

/**
 * Two-tier fix-from-test outcome as a discriminated union on `status`. Each
 * variant carries only the fields it defines, so callers can narrow with
 * `switch (outcome.status)` and get exact-shape TypeScript. `ok: true` means
 * the named test either already passes, will pass after applying, or a fix is
 * available in dry-run; every other case is `ok: false`.
 *
 * Tier-1 failures short-circuit before the test can run:
 *   `no-patch` (compile-blocked, nothing repairable) |
 *   `compile-proposed` (dry-run: repairable compile errors) |
 *   `compile-remaining` (apply: still broken after Tier-1 write).
 *
 * Tier-2 covers the compiling file:
 *   `not-found` | `already-pass` | `no-patch` (no deterministic patch) |
 *   `proposed` (dry-run patch) | `applied` (patch written; carries `regressed`).
 */
export type FixFromTestOutcome =
  | {
      ok: false;
      status: "no-patch";
      /** Compile-tier blockage: file has errors and none are auto-repairable. */
      compileErrors?: KumikiError[];
      /** Test runner threw before any test could execute. */
      testRunError?: string;
      /** Behavioral tier: the target test failed but no deterministic literal repair exists. */
      failingTest?: TestResult;
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "compile-proposed";
      compileFixes: number;
      compilePatches: AutoPatch[];
    }
  | {
      ok: false;
      status: "compile-remaining";
      compileFixes: number;
      compileErrors?: KumikiError[];
      parseError?: string;
    }
  | {
      ok: false;
      status: "not-found";
      availableTests: string[];
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "already-pass";
      pass: true;
      compileFixes?: number;
    }
  | {
      ok: true;
      status: "proposed";
      patch: AutoPatch;
      compileFixes?: number;
    }
  | {
      ok: boolean;
      status: "applied";
      pass: boolean;
      patch: AutoPatch;
      /** Names of other tests that were passing before the write and now fail. Always populated (may be []). */
      regressed: string[];
      compileFixes?: number;
    };

/**
 * Render a string as a Kumiki source literal, or null if it needs an escape the
 * lexer can't represent. The lexer supports only `\n` / `\t` / `\r` / `\"` /
 * `\\` (lexer.ts) — emitting a JSON `\uXXXX` (e.g. for a control char) would
 * produce an invalid `.kumiki` file, so we bail rather than write garbage.
 */
function kumikiStringLit(s: string): string | null {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (code < 0x20)
      return null; // control char Kumiki cannot escape
    else out += ch;
  }
  return `${out}"`;
}

/** 1-based line number of a character offset in `source`. */
function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) if (source[i] === "\n") line++;
  return line;
}

/**
 * A deterministic patch from a failing test, when one is provable: the failing
 * leaf is a string whose *actual* value appears verbatim, exactly once, as a
 * source string literal **in implementation code** (tile / reducer), not in a
 * `test` body. `excludedLineRanges` are the 1-based inclusive line spans of the
 * file's `test` definitions; a match inside one is skipped, because patching a
 * test's own `given` / `expect` data would mutate the fixture into passing
 * without touching any production definition. Returns null when no such patch
 * exists — the caller reports the diff instead.
 */
export function planTestPatch(
  source: string,
  r: TestResult,
  excludedLineRanges: Array<[number, number]> = [],
): AutoPatch | null {
  if (r.pass || !r.leaf) return null;
  const { expected, actual } = r.leaf;
  if (typeof actual !== "string" || typeof expected !== "string" || actual === expected) {
    return null;
  }
  const actualLit = kumikiStringLit(actual);
  const expectedLit = kumikiStringLit(expected);
  if (actualLit === null || expectedLit === null) return null;

  // Collect occurrences outside any `test` body. Determinism requires exactly
  // one: assembled text (concatenation) is never found; a fixture-only literal
  // yields zero implementation hits; duplicates are ambiguous — all → null.
  const inExcluded = (offset: number): boolean => {
    const line = lineOfOffset(source, offset);
    return excludedLineRanges.some(([lo, hi]) => line >= lo && line <= hi);
  };
  const hits: number[] = [];
  for (let idx = source.indexOf(actualLit); idx !== -1; idx = source.indexOf(actualLit, idx + 1)) {
    if (!inExcluded(idx)) hits.push(idx);
  }
  if (hits.length !== 1) return null;
  const hit = hits[0]!;
  const at = r.diffAt ?? "(leaf)";
  return {
    code: "TEST",
    message: `test "${r.name}" failed at ${at}`,
    description: `replace ${actualLit} with ${expectedLit} (from failing test "${r.name}" @ ${at})`,
    // Positional splice at the proven offset — avoids String.replace's first-
    // match-anywhere (which could hit a test body) and `$`-substitution.
    apply: (text: string) => text.slice(0, hit) + expectedLit + text.slice(hit + actualLit.length),
  };
}

/** 1-based inclusive line spans of every `test` definition in `store`. */
function testBodyLineRanges(store: Store): Array<[number, number]> {
  return store.defs
    .filter((e) => e.def.kind === "TestDef")
    .map((e): [number, number] => [e.range.startLine, e.range.endLine]);
}

/**
 * Two-tier fix-from-test. Tier 1 clears compile errors with `planFixes` so the
 * test can run; Tier 2 applies a deterministic literal repair from the failing
 * test with `planTestPatch`. Every branch returns via the `FixFromTestOutcome`
 * discriminated union — no stdout side effects. `fixFromTest` wraps this and
 * adds the CLI printer. The outcome carries compile-tier errors
 * (`compileErrors`), the failing test
 * itself (`failingTest`), and the current set of test results (`tests`) so
 * MCP callers can render diagnostics without stdout scraping.
 */
export async function runFixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  // Tier 1: a file that doesn't compile can't run its tests — repair first.
  const store = load(path);
  const compileErrors = check(store.program, { capabilities });
  let compileFixes = 0;
  if (compileErrors.length > 0) {
    const patches = planFixes(store, compileErrors);
    if (patches.length === 0) {
      return { ok: false, status: "no-patch", compileErrors };
    }
    if (!apply) {
      return {
        ok: true,
        status: "compile-proposed",
        compileFixes: patches.length,
        compilePatches: patches,
      };
    }
    let text = readFileSync(path, "utf8");
    for (const p of patches) text = p.apply(text);
    writeFileSync(path, text);
    compileFixes = patches.length;
    let remaining: ReturnType<typeof check>;
    try {
      remaining = check(parse(lex(text)), { capabilities });
    } catch (e) {
      return {
        ok: false,
        status: "compile-remaining",
        compileFixes,
        parseError: e instanceof Error ? e.message : String(e),
      };
    }
    if (remaining.length > 0) {
      return { ok: false, status: "compile-remaining", compileFixes, compileErrors: remaining };
    }
  }

  // Run the tests on the (now-compiling) file.
  let before: TestResult[];
  try {
    before = await testFile(path, capabilities);
  } catch (e) {
    return {
      ok: false,
      status: "no-patch",
      testRunError: e instanceof Error ? e.message : String(e),
      ...(compileFixes ? { compileFixes } : {}),
    };
  }
  const target = before.find((r) => r.name === testName);
  if (!target) {
    return {
      ok: false,
      status: "not-found",
      availableTests: before.map((r) => r.name),
      ...(compileFixes ? { compileFixes } : {}),
    };
  }
  if (target.pass) {
    return {
      ok: true,
      status: "already-pass",
      pass: true,
      ...(compileFixes ? { compileFixes } : {}),
    };
  }

  // Tier 2: behavioral, deterministic literal repair. Re-load from the current
  // (possibly Tier-1-patched) file so the source and the `test` body line ranges
  // used to exclude fixture literals are consistent.
  const curSource = readFileSync(path, "utf8");
  const patch = planTestPatch(curSource, target, testBodyLineRanges(load(path)));
  if (!patch) {
    return {
      ok: false,
      status: "no-patch",
      failingTest: target,
      ...(compileFixes ? { compileFixes } : {}),
    };
  }
  if (!apply) {
    return { ok: true, status: "proposed", patch, ...(compileFixes ? { compileFixes } : {}) };
  }
  writeFileSync(path, patch.apply(curSource));
  const after = await testFile(path, capabilities);
  const nowPass = after.find((r) => r.name === testName)?.pass === true;
  const regressed = after
    .filter((r) => !r.pass && before.find((b) => b.name === r.name)?.pass === true)
    .map((r) => r.name);
  return {
    ok: nowPass && regressed.length === 0,
    status: "applied",
    pass: nowPass,
    patch,
    // Always populated: `[]` means "checked, none regressed" — never absent
    // on the `applied` branch. Baked into the type by the discriminated union.
    regressed,
    ...(compileFixes ? { compileFixes } : {}),
  };
}

export async function fixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  const outcome = await runFixFromTest(path, testName, apply, capabilities);
  printFixFromTest(outcome, testName);
  return outcome;
}

/** Human-readable print of a `runFixFromTest` outcome. */
function printFixFromTest(outcome: FixFromTestOutcome, testName: string): void {
  // Applied-tier-1 header: only when Tier-1 patches were *written* — i.e. the
  // apply path. `compile-proposed` also carries `compileFixes` (the count of
  // proposed patches), but printing "applied N" for it would lie about a
  // dry-run.
  if (
    outcome.compileFixes !== undefined &&
    outcome.compileFixes > 0 &&
    outcome.status !== "compile-remaining" &&
    outcome.status !== "compile-proposed"
  ) {
    console.log(`applied ${outcome.compileFixes} compile fix(es) — file now compiles`);
  }
  switch (outcome.status) {
    case "no-patch": {
      if (outcome.compileErrors && outcome.compileErrors.length > 0) {
        console.log(
          `(no auto-patch available) — test "${testName}" is blocked by ${outcome.compileErrors.length} compile error(s):`,
        );
        for (const e of outcome.compileErrors) console.error(`  ${e.code} ${e.message}`);
        return;
      }
      if (outcome.testRunError) {
        console.error(`could not run tests: ${outcome.testRunError}`);
        return;
      }
      if (outcome.failingTest) {
        const t = outcome.failingTest;
        console.log(`(no auto-patch available) for failing test "${testName}":`);
        if (t.expected !== undefined) console.log(`  expected: ${t.expected}`);
        if (t.actual !== undefined) console.log(`  actual:   ${t.actual}`);
        if (t.diffAt !== undefined) console.log(`  diff at:  ${t.diffAt}`);
        return;
      }
      console.log(`(no auto-patch available) for "${testName}"`);
      return;
    }
    case "compile-proposed": {
      console.log(`test "${testName}" is blocked by compile errors; proposed fixes (dry-run):`);
      for (const p of outcome.compilePatches ?? []) {
        console.log(`  ${p.code} ${p.message}`);
        console.log(`    fix: ${p.description}`);
      }
      return;
    }
    case "compile-remaining": {
      const n = outcome.compileFixes ?? 0;
      if (outcome.parseError) {
        console.log(
          `applied ${n} compile fix(es) but they broke the file (${outcome.parseError}); cannot run "${testName}"`,
        );
        return;
      }
      const rem = outcome.compileErrors?.length ?? 0;
      console.log(
        `applied ${n} compile fix(es) — ${rem} error(s) remain; cannot run "${testName}"`,
      );
      return;
    }
    case "not-found": {
      const have = (outcome.availableTests ?? []).join(", ") || "none";
      console.error(`no test named "${testName}" (have: ${have})`);
      return;
    }
    case "already-pass": {
      console.log(`test "${testName}" passes — nothing to fix`);
      return;
    }
    case "proposed": {
      if (outcome.patch) {
        console.log(`proposed fix for "${testName}" (dry-run):`);
        console.log(`  ${outcome.patch.description}`);
      }
      return;
    }
    case "applied": {
      const nowPass = outcome.pass === true;
      console.log(`applied fix — test "${testName}" now ${nowPass ? "PASSES" : "still FAILS"}`);
      if (outcome.regressed && outcome.regressed.length > 0) {
        console.log(
          `  WARNING: ${outcome.regressed.length} other test(s) regressed: ${outcome.regressed.join(", ")}`,
        );
      }
      return;
    }
  }
}
