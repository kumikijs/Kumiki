// kumiki fix — propose auto-patches for repairable typecheck errors.

import { readFileSync, writeFileSync } from "node:fs";
import type { KumikiError, TestDef } from "@kumikijs/compiler";
import { check, collectTimerNames, lex, parse, variantTagsOf } from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { testFile } from "./smoke.ts";
import { directDeps, listDefs, load, type Store } from "./store.ts";

export type AutoPatch = {
  code: string;
  message: string;
  /** Free-form description of the fix to be applied. */
  description: string;
  apply: (text: string) => string;
};

/**
 * Reason a `planFixes` branch declined to emit a patch. Every silent `continue`
 * inside `planFixesExplained` maps to one of these — the AI iteration loop uses
 * the identifiers to diagnose why auto-repair stopped landing without having to
 * re-derive the branch from the compiler message. `code` is the diagnostic that
 * would have been repaired (`E0301`, `E0209`, ...); `reason` is a stable
 * kebab-case slug (never a free-form sentence) so tests can pin the classifier.
 */
export type SkipReason = {
  code: string;
  reason: string;
  message: string;
};

/**
 * True when the caller opted in to skip-diagnostics via `KUMIKI_DEBUG=fix`
 * (comma-separated so future scopes can compose: `KUMIKI_DEBUG=fix,smoke`).
 * The parse is intentionally forgiving on whitespace but exact on the token
 * `fix` — a substring match would mis-fire on future scopes like `fix-verbose`.
 */
function debugFixEnabled(): boolean {
  const v = process.env.KUMIKI_DEBUG;
  if (!v) return false;
  return v
    .split(",")
    .map((s) => s.trim())
    .includes("fix");
}

/**
 * Emit a single `console.warn` line for a skip decision when `KUMIKI_DEBUG=fix`
 * is set. Deliberately warn (not log) so it lands on stderr and won't pollute
 * machine-parsable stdout of `kumiki fix`. No-op otherwise, so callers can
 * sprinkle this at every skip site without a guarded `if` around each.
 */
function debugSkip(where: string, reason: string, detail?: string): void {
  if (!debugFixEnabled()) return;
  console.warn(`[kumiki fix] skip ${where}: ${reason}${detail ? ` — ${detail}` : ""}`);
}

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

/**
 * Closest candidate name for `missing` under the same threshold used by every
 * name-suggest branch (Levenshtein ≤ 2 edits or ≤ 25% of the missing name's
 * length). Takes candidates as an iterable so callers can supply a scoped
 * set — top-level defs for the generic `NAME_SUGGEST_CODES` codes, timer
 * names for E0106, variant tags for E0209.
 */
function suggestNameFrom(candidates: Iterable<string>, missing: string): string | null {
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    const d = levenshtein(missing, cand);
    if (d < bestScore) {
      bestScore = d;
      best = cand;
    }
  }
  if (best === null) return null;
  if (bestScore <= 2 || bestScore <= Math.ceil(missing.length * 0.25)) return best;
  return null;
}

function suggestName(store: Store, missing: string): string | null {
  return suggestNameFrom(
    listDefs(store).map((e) => e.name),
    missing,
  );
}

/**
 * Append a capability name to an app's `caps = [...]` array, constrained to
 * the given line range so the search cannot accidentally hit a same-name field
 * elsewhere in the source. Returns:
 *   - a rewritten source when the caller's cap was added
 *   - `null` when no `caps = [...]` field exists in the range OR the cap was
 *     already present (no-op — nothing to patch)
 * A null return means "no patch was made"; the caller must not present the
 * patch as `applied`. The regex tolerates arbitrary whitespace around `caps`
 * / `=` and either empty (`[]`) or populated (`[a, b]`) arrays.
 */
function appendAppCap(text: string, cap: string, appRange: [number, number] | null): string | null {
  const lines = text.split(/\r?\n/);
  const start = appRange ? appRange[0] - 1 : 0;
  const end = appRange ? Math.min(appRange[1], lines.length) : lines.length;
  const scoped = lines.slice(start, end).join("\n");
  const re = /(caps\s*=\s*\[)([^\]]*)(\])/;
  const match = re.exec(scoped);
  if (!match) return null;
  const items = match[2]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.includes(cap)) return null;
  items.push(cap);
  const patchedScoped = `${scoped.slice(0, match.index)}${match[1]}${items.join(", ")}${match[3]}${scoped.slice(match.index + match[0].length)}`;
  return [...lines.slice(0, start), ...patchedScoped.split("\n"), ...lines.slice(end)].join("\n");
}

/**
 * Diagnostic codes whose message shape is `... "<name>" ...` and whose repair
 * is "replace the misspelled name with a close top-level definition name".
 * `planFixes` extracts the quoted name and consults `suggestName` (which pulls
 * from `listDefs(store)`) for every code in this set.
 *
 * Handled with a *scoped* candidate set in their own branch below (not in this
 * set, because top-level defs would produce wrong suggestions):
 *   - **E0106** (undef-timer) — timer names live in `SymbolTable.timerNames`;
 *     we mirror them via `collectTimerNames(program)` and never fall back to
 *     top-level defs.
 *   - **E0209** (pat-unknown-variant) — variant tags live inside the union
 *     type's payload list; we resolve them via `variantTagsOf(typeName,
 *     program)` (built-in `Option` / `Result` plus user `TypeDef` bodies).
 * Adding either code back to *this* set would reintroduce the silent
 * corruption PR #175 removed — the shared candidate list has no timer /
 * variant entries and would suggest an unrelated tile or reducer.
 */
const NAME_SUGGEST_CODES: ReadonlySet<string> = new Set([
  "E0102", // undef-reducer
  "E0103", // undef-ref / undef-slot
  "E0104", // undef-effect
  "E0105", // undef-tile
  "E0107", // undef-motion
  "E0211", // undef-tile-in-selector
]);

/**
 * Explained variant of `planFixes`: returns the same auto-patches plus a
 * parallel `skipped` list carrying a stable kebab-case reason per silent
 * `continue`. The AI iteration loop consumes `skipped` to explain "why no
 * patch landed" and to detect compiler-message-format drift (all quoted-name
 * branches share a `*-quoted-name-extract-failed` reason — a sudden spike is
 * the signal). The plain `planFixes` is a thin wrapper for backward
 * compatibility; every silent skip now also flows through `debugSkip` so
 * `KUMIKI_DEBUG=fix` surfaces the same reasons at runtime.
 */
export function planFixesExplained(
  store: Store,
  errors: KumikiError[],
): { patches: AutoPatch[]; skipped: SkipReason[] } {
  const patches: AutoPatch[] = [];
  const skipped: SkipReason[] = [];
  const skip = (code: string, reason: string, message: string): void => {
    skipped.push({ code, reason, message });
    debugSkip(`planFixes:${code}`, reason, message);
  };
  for (const err of errors) {
    if (NAME_SUGGEST_CODES.has(err.code)) {
      // Most diagnostics quote a single name; E0211 quotes the reducer name
      // *and then* the tile name — the tile is what needs suggesting, so pick
      // the last quoted name for that code specifically.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length === 0) {
        skip(err.code, "quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = err.code === "E0211" ? quoted[quoted.length - 1]! : quoted[0]!;
      const suggested = suggestName(store, missing);
      if (!suggested) {
        skip(err.code, "no-close-name-suggestion", err.message);
        continue;
      }
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
    if (err.code === "E0106") {
      // Message shape: `stop-timer refers to undefined timer name "<name>"`.
      // The candidate set is the timer namespace, not top-level defs — see
      // NAME_SUGGEST_CODES doc-comment for why this branch is separate.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length === 0) {
        skip(err.code, "e0106-quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const timers = collectTimerNames(store.program);
      if (timers.size === 0) {
        skip(err.code, "e0106-empty-timer-namespace", err.message);
        continue;
      }
      const suggested = suggestNameFrom(timers, missing);
      if (!suggested) {
        skip(err.code, "e0106-no-close-timer", err.message);
        continue;
      }
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
    if (err.code === "E0209") {
      // Message shape: `Variant "<tag>" is not a member of scrutinee type "<T>"`.
      // Candidates are the union's tag list, not top-level defs. `<T>` may be
      // rendered as `Option(Int)` / `Result(Ok, Err)` / a plain `TypeRef` name;
      // `variantTagsOf` strips the generic argument list and resolves aliases.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length < 2) {
        skip(err.code, "e0209-quoted-pair-missing", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const typeName = quoted[1]!;
      const tags = variantTagsOf(typeName, store.program);
      if (!tags || tags.length === 0) {
        skip(err.code, "e0209-unresolved-variant-type", err.message);
        continue;
      }
      const suggested = suggestNameFrom(tags, missing);
      if (!suggested) {
        skip(err.code, "e0209-no-close-tag", err.message);
        continue;
      }
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
    if (err.code === "E0301") {
      // "Effect "<effect>" requires capability "<cap>" which is not declared in app.caps"
      // — extract <cap> and append it to the app's `caps = [...]` array. Only
      // emit a patch when the app def is reachable AND `appendAppCap` produced
      // a mutated source. A no-op patch (silent unchanged input) would be
      // reported as `applied: 1` despite doing nothing, which the regression
      // gate can't catch on its own (nothing changed ⇒ same errors ⇒ same
      // count) — the pre-check here keeps the "applied ⇔ source changed"
      // invariant.
      const capMatch = /requires capability "([^"]+)"/.exec(err.message);
      if (!capMatch) {
        skip(err.code, "e0301-cap-name-extract-failed", err.message);
        continue;
      }
      const cap = capMatch[1]!;
      const appEntry = store.defs.find((e) => e.def.kind === "AppDef");
      if (!appEntry) {
        skip(err.code, "e0301-no-app-def", err.message);
        continue;
      }
      const appRange: [number, number] = [appEntry.range.startLine, appEntry.range.endLine];
      const dryRun = appendAppCap(store.source, cap, appRange);
      if (dryRun === null) {
        skip(err.code, "e0301-cap-already-present-or-no-caps-field", err.message);
        continue;
      }
      patches.push({
        code: err.code,
        message: err.message,
        description: `add capability "${cap}" to app.caps`,
        apply: (text: string) => appendAppCap(text, cap, appRange) ?? text,
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
  return { patches, skipped };
}

export function planFixes(store: Store, errors: KumikiError[]): AutoPatch[] {
  return planFixesExplained(store, errors).patches;
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
  // Regression gate. Every path that would touch disk first re-parses and
  // re-typechecks the composed source, then compares diagnostic *sets* (code
  // + position) rather than counts. Rollback triggers when any of:
  //   1. The composed source no longer parses at all — a *parse-error* is
  //      strictly worse than the original type errors, so we discard even
  //      though the pre-patch file had errors.
  //   2. Any diagnostic exists in `after` but not `before` — introduced a
  //      new failure. Catches 1-for-1 swaps (E0301→E0302 via typo) that a
  //      count-only guard would miss.
  //   3. No diagnostic from `before` was resolved — the patch either did
  //      nothing (silent noop) or replaced errors position-for-position
  //      with different codes (still a swap).
  // Invariant: "apply => file is either strictly cleaner or unchanged".
  // Callers observe rollback via `applied === 0 && regressionBlocked === true`.
  const key = (e: KumikiError): string => `${e.code}@${e.pos.line}:${e.pos.col}`;
  const beforeSet = new Set(plan.errors.map(key));
  let dryRemaining: KumikiError[];
  try {
    const next = parse(lex(after));
    dryRemaining = check(next, { capabilities });
  } catch (e) {
    // Parse-error rollback (case 1). Do NOT write. The synthetic E0000 in
    // `remaining` and the `parseError` string surface the parser's message
    // for callers rendering diagnostics; `regressionBlocked` distinguishes
    // this from "genuinely no patch available".
    const message = e instanceof Error ? e.message : String(e);
    const pe = e as { pos?: { line: number; col: number } };
    const synthetic: KumikiError = {
      code: "E0000",
      kind: "parse-error",
      message,
      pos: { line: pe.pos?.line ?? 0, col: pe.pos?.col ?? 0 },
    };
    return {
      applied: 0,
      before,
      after: before,
      remaining: [...plan.errors, synthetic],
      regressionBlocked: true,
      parseError: message,
    };
  }
  const afterSet = new Set(dryRemaining.map(key));
  const introduced = dryRemaining.filter((e) => !beforeSet.has(key(e)));
  const resolved = plan.errors.filter((e) => !afterSet.has(key(e)));
  if (introduced.length > 0 || resolved.length === 0) {
    return {
      applied: 0,
      before,
      after: before,
      remaining: plan.errors,
      regressionBlocked: true,
    };
  }
  writeFileSync(path, after);
  return { applied: plan.patches.length, before, after, remaining: dryRemaining };
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
  /**
   * True when the composed patch would have introduced *more* diagnostics
   * than the pre-patch file had — the regression gate rolled the write back
   * and `applied` is `0`. Absent means either the patch cleanly applied or
   * there was nothing to apply.
   */
  regressionBlocked?: boolean;
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
    if (result.regressionBlocked) {
      console.log("(auto-patch rolled back — it would have introduced new errors)");
    } else {
      console.log("(no auto-patches available)");
    }
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
      /**
       * Stable kebab-case classifier for the silent-skip that produced the
       * no-patch outcome. Compile-tier: taken from the first `planFixesExplained`
       * skip entry when every error skipped; behavioral tier: the tier planner's
       * bail reason. Absent when no classifier applies (compile errors exist but
       * some were unhandled without hitting a skip branch — rare).
       */
      reason?: string;
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
 * Longest common prefix + suffix decomposition. Returns the two divergent
 * middles: `actual = P + midA + S`, `expected = P + midE + S`. When one side
 * is a strict prefix/suffix of the other, one middle is empty. Used by the
 * string-partial-repair path in `planTestPatch` to isolate the smallest
 * substring to swap inside a shared literal.
 */
function affixDiff(a: string, b: string): { pfx: string; midA: string; midE: string; sfx: string } {
  let p = 0;
  const minLen = Math.min(a.length, b.length);
  while (p < minLen && a[p] === b[p]) p++;
  let s = 0;
  while (s < minLen - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return {
    pfx: a.slice(0, p),
    midA: a.slice(p, a.length - s),
    midE: b.slice(p, b.length - s),
    sfx: a.slice(a.length - s),
  };
}

/**
 * Render a number as a Kumiki numeric literal source form (`Int` or fractional).
 * Rejects NaN / Infinity — those cannot be spelled as literals and would break
 * `.kumiki` parsing.
 */
function kumikiNumberLit(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  return String(n);
}

/** 1-based inclusive line spans of every `test` definition in `store`. */
function testBodyLineRanges(store: Store): Array<[number, number]> {
  return store.defs
    .filter((e) => e.def.kind === "TestDef")
    .map((e): [number, number] => [e.range.startLine, e.range.endLine]);
}

/**
 * Line ranges of the target def and every def it transitively references, used
 * to constrain a literal search to code the failing test can actually reach.
 * Returned as (target-range, dependency-ranges) so the caller can prefer a hit
 * in the target itself before falling back to its dependencies. Returns null
 * when the target can't be resolved — the caller falls back to whole-file
 * search.
 */
function scopeOfTest(
  store: Store,
  testName: string,
): { target: [number, number]; deps: Array<[number, number]> } | null {
  const testEntry = store.defs.find((e) => e.def.kind === "TestDef" && e.name === testName);
  if (!testEntry) return null;
  const td = testEntry.def as TestDef;
  if (!td.target) return null;
  // Explicit switch — `property-test` / `episode-test` do not have a scope
  // to disambiguate against, so return null instead of silently falling into
  // the reducer namespace (which would misresolve a same-name reducer).
  let targetQname: string;
  switch (td.testKind) {
    case "tile-test":
      targetQname = `tile.${td.target}`;
      break;
    case "reducer-test":
      targetQname = `reducer.${td.target}`;
      break;
    default:
      return null;
  }
  const target = store.byQName.get(targetQname);
  if (!target) return null;
  const deps: Array<[number, number]> = [];
  for (const dq of directDeps(store, targetQname)) {
    const dep = store.byQName.get(dq);
    if (dep) deps.push([dep.range.startLine, dep.range.endLine]);
  }
  return { target: [target.range.startLine, target.range.endLine], deps };
}

/**
 * Reducers that write to `slot.<slotName>`. Returned as line ranges plus each
 * def's raw source so the arithmetic-pattern search can inspect the body
 * directly without re-slicing lines. Used by `planTestPatch` when the failing
 * leaf is a numeric slot mismatch.
 */
function reducersWritingSlot(
  store: Store,
  slotName: string,
): Array<{ range: [number, number]; body: string; name: string }> {
  const out: Array<{ range: [number, number]; body: string; name: string }> = [];
  const assignRe = new RegExp(`\\b${escapeRegex(slotName)}\\s*:=`);
  for (const e of store.defs) {
    if (e.def.kind !== "ReducerDef") continue;
    const body = store.lines.slice(e.range.startLine - 1, e.range.endLine).join("\n");
    if (assignRe.test(body))
      out.push({ range: [e.range.startLine, e.range.endLine], name: e.name, body });
  }
  return out;
}

/**
 * A deterministic patch from a failing test. Two tiers of relaxation over the
 * naive "actual appears exactly once as a source literal" rule:
 *
 * 1. Exact-literal repair — `actual` appears verbatim. Scope-aware
 *    disambiguation (via `store`): prefer a hit inside the target def's line
 *    range, then a dependency of the target, before rejecting ambiguity.
 *    Handles string / number / boolean leaves.
 * 2. Prefix-suffix repair — `actual` and `expected` share a common prefix and
 *    suffix; the divergent middle is a substring of an implementation literal.
 *    Swap the middle only.
 * 3. Arithmetic repair — a numeric slot mismatch where the responsible reducer
 *    body has a `slot := slot ± N` shape. Reproduce the actual/expected delta
 *    to pick the corrected operator/operand.
 *
 * `excludedLineRanges` are the 1-based inclusive line spans of the file's
 * `test` definitions; matches inside them are skipped so a fixture literal is
 * never patched into passing. `store` is optional — without it, the function
 * degrades to the pre-relax exactly-one behavior for backward compatibility
 * with the existing external API.
 */
/**
 * Explained variant of `planTestPatch`: returns either the same `AutoPatch` or
 * a stable kebab-case `reason` explaining why no tier produced a patch. The
 * `reason` is what the AI iteration loop consumes to distinguish "no
 * deterministic repair exists" from "compiler diagnostic format drifted";
 * every silent `return null` inside the tier planners maps to one identifier
 * here (see the plan doc in issue #177). Each early exit also flows through
 * `debugSkip` so `KUMIKI_DEBUG=fix` surfaces the same reason at runtime. The
 * plain `planTestPatch` is a wrapper for backward compatibility.
 */
export function planTestPatchExplained(
  source: string,
  r: TestResult,
  excludedLineRanges: Array<[number, number]> = [],
  store?: Store,
): { patch: AutoPatch } | { patch: null; reason: string } {
  const bail = (reason: string): { patch: null; reason: string } => {
    debugSkip("planTestPatch", reason, r.name);
    return { patch: null, reason };
  };
  if (r.pass || !r.leaf) return bail("test-passes-or-no-leaf");
  const { expected, actual } = r.leaf;
  if (actual === expected) return bail("leaf-equal-no-diff");
  const at = r.diffAt ?? "(leaf)";
  const inExcluded = (offset: number): boolean => {
    const line = lineOfOffset(source, offset);
    return excludedLineRanges.some(([lo, hi]) => line >= lo && line <= hi);
  };
  const scope = store ? scopeOfTest(store, r.name) : null;

  // ----- Tier 1: exact-literal repair (string / number / boolean) -----

  const exact = planExactLiteralPatchExplained(source, r, actual, expected, at, inExcluded, scope);
  if (exact.patch) return { patch: exact.patch };
  const tier1Reason = exact.reason;

  // ----- Tier 2: string prefix/suffix partial repair -----

  let tier2Reason: string | null = null;
  if (typeof actual === "string" && typeof expected === "string") {
    const partial = planPartialStringPatchExplained(
      source,
      r,
      actual,
      expected,
      at,
      inExcluded,
      scope,
    );
    if (partial.patch) return { patch: partial.patch };
    tier2Reason = partial.reason;
  }

  // ----- Tier 3: numeric slot delta → reducer arithmetic pattern -----

  let tier3Reason: string | null = null;
  if (
    store &&
    typeof actual === "number" &&
    typeof expected === "number" &&
    typeof r.diffAt === "string" &&
    r.diffAt.startsWith("slots.")
  ) {
    const slotName = r.diffAt.slice("slots.".length);
    const arith = planArithmeticPatchExplained(
      source,
      r,
      slotName,
      actual,
      expected,
      at,
      store,
      inExcluded,
    );
    if (arith.patch) return { patch: arith.patch };
    tier3Reason = arith.reason;
  }

  // Prefer the most specific tier's reason: Tier-3 (arithmetic) if it ran,
  // then Tier-2 (partial string), else Tier-1 (exact-literal). This surfaces
  // *why the deepest tier declined* rather than the coarse first-line signal.
  const reason = tier3Reason ?? tier2Reason ?? tier1Reason;
  debugSkip("planTestPatch", reason, r.name);
  return { patch: null, reason };
}

export function planTestPatch(
  source: string,
  r: TestResult,
  excludedLineRanges: Array<[number, number]> = [],
  store?: Store,
): AutoPatch | null {
  return planTestPatchExplained(source, r, excludedLineRanges, store).patch;
}

/**
 * Render a leaf value as a Kumiki source literal for the exact-match tier.
 * String / number / boolean are supported; anything else returns null.
 */
function leafLit(v: unknown): string | null {
  if (typeof v === "string") return kumikiStringLit(v);
  if (typeof v === "number") return kumikiNumberLit(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/**
 * Locate hits of a literal outside any test body, then rank them: hits inside
 * the target's line range win; hits inside a dependency range are runners-up;
 * everything else is last. Returns the single winner offset when unambiguous,
 * or null when the top rank has more than one hit (still ambiguous). Used by
 * exact-literal and partial-string patches; encapsulates the shared
 * disambiguation policy so both paths behave identically.
 */
function pickScopedHit(
  source: string,
  needle: string,
  inExcluded: (offset: number) => boolean,
  scope: { target: [number, number]; deps: Array<[number, number]> } | null,
): number | null {
  const hits: number[] = [];
  for (let idx = source.indexOf(needle); idx !== -1; idx = source.indexOf(needle, idx + 1)) {
    if (!inExcluded(idx)) hits.push(idx);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  if (!scope) return null;
  const inRange = (offset: number, range: [number, number]): boolean => {
    const line = lineOfOffset(source, offset);
    return line >= range[0] && line <= range[1];
  };
  const inTarget = hits.filter((h) => inRange(h, scope.target));
  if (inTarget.length === 1) return inTarget[0]!;
  if (inTarget.length > 1) return null;
  const inDeps = hits.filter((h) => scope.deps.some((r) => inRange(h, r)));
  if (inDeps.length === 1) return inDeps[0]!;
  return null;
}

/**
 * True at offsets that sit inside a `"..."` string literal. Number / boolean
 * exact-literal searches must reject these so a leaf like `-1` doesn't get
 * matched against the substring `-1` inside a source string like `text="-1"`.
 * Cached per call via a closure — pre-scanning the whole source once beats
 * re-checking every candidate hit.
 */
function stringLiteralSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /"(?:[^"\\]|\\.)*"/g;
  let m: RegExpExecArray | null = re.exec(source);
  while (m !== null) {
    spans.push([m.index, m.index + m[0].length]);
    m = re.exec(source);
  }
  return spans;
}

type PatchOrReason = { patch: AutoPatch } | { patch: null; reason: string };

function planExactLiteralPatchExplained(
  source: string,
  r: TestResult,
  actual: unknown,
  expected: unknown,
  at: string,
  inExcluded: (offset: number) => boolean,
  scope: { target: [number, number]; deps: Array<[number, number]> } | null,
): PatchOrReason {
  const actualLit = leafLit(actual);
  const expectedLit = leafLit(expected);
  if (actualLit === null || expectedLit === null)
    return { patch: null, reason: "leaf-not-a-kumiki-literal" };
  // For non-string leaves, hits inside string literals are false positives
  // (e.g. numeric `-1` matching inside `text="-1"`). Build a rejection filter
  // that composes with `inExcluded`.
  const isStringLeaf = typeof actual === "string";
  const spans = isStringLeaf ? null : stringLiteralSpans(source);
  const combinedExcluded = spans
    ? (offset: number): boolean =>
        inExcluded(offset) ||
        spans.some(([lo, hi]) => offset >= lo && offset + actualLit.length <= hi)
    : inExcluded;
  const hit = pickScopedHit(source, actualLit, combinedExcluded, scope);
  if (hit === null) return { patch: null, reason: "no-scoped-literal-hit" };
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: `replace ${actualLit} with ${expectedLit} (from failing test "${r.name}" @ ${at})`,
      apply: (text: string) =>
        text.slice(0, hit) + expectedLit + text.slice(hit + actualLit.length),
    },
  };
}

function planPartialStringPatchExplained(
  source: string,
  r: TestResult,
  actual: string,
  expected: string,
  at: string,
  inExcluded: (offset: number) => boolean,
  scope: { target: [number, number]; deps: Array<[number, number]> } | null,
): PatchOrReason {
  const { midA, midE } = affixDiff(actual, expected);
  // If either side has an empty middle we're in the exact-literal tier and it
  // already ran; skip so the two paths don't compete.
  if (midA.length === 0 || midE.length === 0) return { patch: null, reason: "affix-empty-middle" };
  // The exact-literal search would've been used if `actual` itself appeared;
  // here we look for a string literal containing `midA` as a substring. Walk
  // every `"..."` in the source and score by scope.
  const literalRe = /"(?:[^"\\]|\\.)*"/g;
  type Match = { start: number; end: number; body: string };
  const matches: Match[] = [];
  let m: RegExpExecArray | null = literalRe.exec(source);
  while (m !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Body without surrounding quotes.
    if (!inExcluded(start) && m[0].includes(midA))
      matches.push({ start, end, body: m[0].slice(1, -1) });
    m = literalRe.exec(source);
  }
  if (matches.length === 0) return { patch: null, reason: "no-string-literal-contains-mida" };
  const rank = (offset: number): number => {
    if (!scope) return 2;
    const line = lineOfOffset(source, offset);
    if (line >= scope.target[0] && line <= scope.target[1]) return 0;
    if (scope.deps.some(([lo, hi]) => line >= lo && line <= hi)) return 1;
    return 2;
  };
  const ranked = matches.map((mm) => ({ mm, rank: rank(mm.start) }));
  const minRank = Math.min(...ranked.map((x) => x.rank));
  const top = ranked.filter((x) => x.rank === minRank).map((x) => x.mm);
  if (top.length !== 1) return { patch: null, reason: "ambiguous-string-literal-match" };
  const target = top[0]!;
  // Rebuild the literal with `midA` swapped for `midE`, keeping the rest of
  // the string exactly as authored (so any escape sequences the developer
  // typed pass through untouched).
  const bodyIdx = target.body.indexOf(midA);
  if (bodyIdx < 0) return { patch: null, reason: "internal-body-not-found" };
  const patchedBody =
    target.body.slice(0, bodyIdx) + midE + target.body.slice(bodyIdx + midA.length);
  // Guard: the new body must still be spellable as a Kumiki literal (no raw
  // control chars via `midE`).
  const patchedLit = kumikiStringLit(patchedBody);
  if (patchedLit === null) return { patch: null, reason: "patched-body-unspellable" };
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: `replace "${midA}" with "${midE}" inside "${target.body}" (from failing test "${r.name}" @ ${at})`,
      apply: (text: string) => text.slice(0, target.start) + patchedLit + text.slice(target.end),
    },
  };
}

function planArithmeticPatchExplained(
  source: string,
  r: TestResult,
  slotName: string,
  actual: number,
  expected: number,
  at: string,
  store: Store,
  inExcluded: (offset: number) => boolean,
): PatchOrReason {
  // Find reducers writing to this slot. When more than one exists, we can't
  // pick — the caller falls back to no-patch.
  const reducers = reducersWritingSlot(store, slotName);
  if (reducers.length !== 1) return { patch: null, reason: "ambiguous-reducer-set" };
  const red = reducers[0]!;
  // Match `<slot> := <slot> <op> <N>` where <op> is `+` / `-` / `*`. `N` is
  // an Int literal (the arithmetic tier deliberately doesn't handle mixed
  // expressions — those are out of scope by AC).
  const stmtRe = new RegExp(
    `\\b${escapeRegex(slotName)}\\s*:=\\s*${escapeRegex(slotName)}\\s*([+\\-*])\\s*(-?\\d+)\\b`,
  );
  const bodyMatch = stmtRe.exec(red.body);
  if (!bodyMatch) return { patch: null, reason: "no-additive-multiplicative-shape" };
  const op = bodyMatch[1] as "+" | "-" | "*";
  const n = Number.parseInt(bodyMatch[2]!, 10);
  if (!Number.isFinite(n)) return { patch: null, reason: "non-finite-operand" };
  // Reproduce what the reducer added: `+ N` → delta = +N, `- N` → delta = -N.
  // The initial `<slot>` value at test time is `actual - delta`. Solve for the
  // new op/N whose delta equals `expected - (actual - delta)`.
  let newLine: string | null = null;
  let newDesc = "";
  if (op === "+" || op === "-") {
    const delta = op === "+" ? n : -n;
    const base = actual - delta;
    const wantedDelta = expected - base;
    if (wantedDelta === 0) return { patch: null, reason: "additive-zero-delta" };
    const newOp = wantedDelta > 0 ? "+" : "-";
    const newN = Math.abs(wantedDelta);
    if (newOp === op && newN === n) return { patch: null, reason: "additive-noop-solution" };
    newLine = `${slotName} := ${slotName} ${newOp} ${newN}`;
    newDesc = `reducer "${red.name}": ${slotName} := ${slotName} ${op} ${n} → ${newLine}`;
  } else {
    // Multiplicative — solve N' from expected = base * N' where base = actual / n.
    if (n === 0 || actual === 0) return { patch: null, reason: "multiplicative-zero-guard" };
    const base = actual / n;
    if (!Number.isInteger(base) || base === 0)
      return { patch: null, reason: "multiplicative-nonintegral-base" };
    const newN = expected / base;
    if (!Number.isInteger(newN) || newN === n)
      return { patch: null, reason: "multiplicative-nonintegral-solution" };
    newLine = `${slotName} := ${slotName} * ${newN}`;
    newDesc = `reducer "${red.name}": ${slotName} := ${slotName} * ${n} → ${newLine}`;
  }
  // Positional splice — locate the match within source (not just the body).
  const globalRe = new RegExp(stmtRe.source, "g");
  let sourceMatch: RegExpExecArray | null = null;
  let running: RegExpExecArray | null = globalRe.exec(source);
  while (running !== null) {
    if (
      !inExcluded(running.index) &&
      lineOfOffset(source, running.index) >= red.range[0] &&
      lineOfOffset(source, running.index) <= red.range[1]
    ) {
      sourceMatch = running;
      break;
    }
    running = globalRe.exec(source);
  }
  if (!sourceMatch) return { patch: null, reason: "arithmetic-splice-target-lost" };
  const start = sourceMatch.index;
  const end = start + sourceMatch[0].length;
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: newDesc,
      apply: (text: string) => text.slice(0, start) + newLine + text.slice(end),
    },
  };
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
    const { patches, skipped } = planFixesExplained(store, compileErrors);
    if (patches.length === 0) {
      // Surface the first skip reason so the AI loop can distinguish
      // "no auto-repairable code fired" from "the compiler message drifted
      // and every quoted-name branch fell through". Absent when the compile
      // errors didn't match any repair branch at all (no skip recorded).
      const reason = skipped[0]?.reason;
      return { ok: false, status: "no-patch", compileErrors, ...(reason ? { reason } : {}) };
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
  // (possibly Tier-1-patched) file so the source, the `test` body line ranges
  // used to exclude fixture literals, and the scope-aware disambiguation store
  // are all consistent.
  const curSource = readFileSync(path, "utf8");
  const curStore = load(path);
  const attempt = planTestPatchExplained(curSource, target, testBodyLineRanges(curStore), curStore);
  if (!attempt.patch) {
    return {
      ok: false,
      status: "no-patch",
      failingTest: target,
      reason: attempt.reason,
      ...(compileFixes ? { compileFixes } : {}),
    };
  }
  const patch = attempt.patch;
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
        if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
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
        if (outcome.reason) console.log(`  reason:   ${outcome.reason}`);
        return;
      }
      const suffix = outcome.reason ? ` [${outcome.reason}]` : "";
      console.log(`(no auto-patch available) for "${testName}"${suffix}`);
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
