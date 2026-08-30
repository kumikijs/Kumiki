// kumiki fix — propose auto-patches for repairable typecheck errors.

// `writeFileSync` is dereferenced through the `node:fs` namespace so tests can
// intercept it — a plain named import would be resolved as a snapshot binding
// by Vitest's mock spread, defeating `vi.spyOn(fs, "writeFileSync")`. Property
// access on the namespace goes through the live slot every call. `readFileSync`
// stays named — no test needs to mock reads.
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import type { KumikiError, Pos, TestDef } from "@kumikijs/compiler";
import {
  BUILTIN_EFFECT_CAPS,
  calleeCandidates,
  check,
  collectTimerNames,
  lex,
  parse,
  typeCandidates,
  variantTagsOf,
} from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { testFile } from "./smoke.ts";
import { directDeps, listDefs, load, type Store } from "./store.ts";

/**
 * How much of the source a patch's `apply` disturbs — the only thing that
 * decides what order a plan may be composed in.
 *
 * A repair whose replacement is a different length shifts everything after it,
 * and the regression gate reads a diagnostic's identity as `code@line:col`. So
 * a patch applied before another that writes to its left turns that other one's
 * diagnostic into an "introduced" one and rolls the whole plan back.
 *
 * `span` is the precise case and composes from the right. `line` cannot: it
 * rewrites the first match on its line wherever that is, so it can move a
 * column no `pos` predicts, and it goes after every `span`. `region` is
 * everything whose write this plan does not express as a position — text added
 * or extended elsewhere in the file (which moves whole lines), and the
 * offset-addressed splices `planTestPatch` builds, which are applied alone. It
 * goes last.
 */
export type PatchAnchor =
  | { kind: "span"; pos: Pos }
  | { kind: "line"; pos: Pos }
  | { kind: "region" };

export type AutoPatch = {
  code: string;
  message: string;
  /** Free-form description of the fix to be applied. */
  description: string;
  apply: (text: string) => string;
  /**
   * What this patch disturbs. Required, so a new repair branch has to answer
   * it — the previous optional field was silently omitted by two branches and
   * they were composed as though they wrote where their diagnostic pointed.
   */
  anchor: PatchAnchor;
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
 * (comma-separated so scopes can compose: `KUMIKI_DEBUG=fix,smoke`). The
 * parse is intentionally forgiving on whitespace but exact-token match on
 * `fix` — a substring match would mis-fire on scope names sharing a prefix
 * (`fix-verbose`, `not-fix`) or containing `fix` as a fragment.
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
 * The identifier at `pos`, when the expression starting there IS that
 * identifier and nothing more. `null` for anything a suffix cannot simply be
 * appended to — a call, an index, an existing field access — because the
 * diagnostic gives the start of the expression and not its end.
 */
function identifierAt(store: Store, pos: Pos): string | null {
  const line = store.lines[pos.line - 1];
  if (line === undefined) return null;
  const rest = line.slice(pos.col - 1);
  const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest);
  if (!m) return null;
  const after = rest.slice(m[0].length);
  if (/^[.([]/.test(after)) return null;
  return m[0];
}

/**
 * Where line `line` (1-based) starts and where it ends, as offsets into `text`.
 * `end` is the offset of the terminator, so on a CRLF file the slice
 * `[start, end)` keeps the trailing `\r`. Neither consumer minds: a `\b`-search
 * is unaffected by it (`\r` is not a word character), and no name a repair
 * writes can contain one.
 *
 * Everything that edits a line goes through this rather than
 * `split(/\r?\n/).join("\n")`, which rewrites every CRLF in the file to LF —
 * a whole-file diff for a one-token repair, on the platform where CRLF is the
 * default, with nothing said about it.
 */
function lineSpan(text: string, line: number): { start: number; end: number } | null {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return null;
    start = nl + 1;
  }
  if (start > text.length) return null;
  const nl = text.indexOf("\n", start);
  return { start, end: nl === -1 ? text.length : nl };
}

/**
 * Replace `missing` with `replacement` at exactly the reported position.
 *
 * The name-suggest branches historically replaced the first `\b`-delimited
 * match on the diagnostic's line, which is not the same thing: Kumiki
 * identifiers are kebab-case and `\b` matches either side of a `-`, so the
 * first match on `n := re-laod(laod(n))` is inside `re-laod` even when the
 * diagnostic points at `laod`. Returns the text unchanged when the position
 * does not hold `missing` — the caller's regression gate then rolls the patch
 * back rather than writing a rewrite of something else.
 */
function replaceAt(text: string, pos: Pos, missing: string, replacement: string): string {
  const span = lineSpan(text, pos.line);
  if (!span) return text;
  const at = span.start + pos.col - 1;
  if (at + missing.length > span.end) return text;
  if (text.slice(at, at + missing.length) !== missing) return text;
  return text.slice(0, at) + replacement + text.slice(at + missing.length);
}

/**
 * Replace the first `\b`-delimited `missing` anywhere on line `pos.line`.
 *
 * The fallback for a diagnostic whose position is not the name it quotes —
 * E0211 reports at the reducer and names the tile — where there is nothing to
 * measure from and the line is the only handle. Which is why a patch built
 * this way is anchored `line` and never composed as though it wrote at `pos`.
 */
function replaceOnLine(text: string, pos: Pos, missing: string, replacement: string): string {
  const span = lineSpan(text, pos.line);
  if (!span) return text;
  const line = text.slice(span.start, span.end);
  const re = new RegExp(`\\b${escapeRegex(missing)}\\b`);
  const at = line.search(re);
  if (at === -1) return text;
  return (
    text.slice(0, span.start + at) + replacement + text.slice(span.start + at + missing.length)
  );
}

/**
 * The anchor a name-suggest repair deserves: `span` when the reported column
 * really holds the name it quotes, `line` when it does not. Nothing declares
 * which diagnostics are which — E0211's position is the reducer and its name
 * is a tile, and the rest point at the name — so it is measured rather than
 * listed, and a diagnostic that changes where it points changes anchor with it.
 */
function nameAnchor(store: Store, pos: Pos, missing: string): PatchAnchor {
  const line = store.lines[pos.line - 1];
  const at = pos.col - 1;
  return line !== undefined && line.slice(at, at + missing.length) === missing
    ? { kind: "span", pos }
    : { kind: "line", pos };
}

/** Apply a name-suggest repair the way its anchor says it writes. */
function applyNameFix(anchor: PatchAnchor, missing: string, suggested: string) {
  return (text: string): string =>
    anchor.kind === "span"
      ? replaceAt(text, anchor.pos, missing, suggested)
      : anchor.kind === "line"
        ? replaceOnLine(text, anchor.pos, missing, suggested)
        : text;
}

/**
 * Write a file such that a failure (EACCES / ENOSPC / EBUSY) leaves the target
 * byte-identical to before the call. Node's `writeFileSync` opens with
 * `O_TRUNC`, so a mid-write ENOSPC produces a truncated file — unsafe for a
 * repair tool whose contract is "cleaner or unchanged". We stage the content
 * to a sibling temp file first, then `renameSync` it over the target.
 * `renameSync` is atomic on the same filesystem on both POSIX and Windows
 * (via `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`). On any throw the temp
 * file is best-effort unlinked so a subsequent retry sees a clean directory.
 */
function atomicWriteFileSync(path: string, content: string): void {
  const tmp = `${path}.kumiki-tmp`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, path);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Temp file may not exist (throw happened before create) or belong to a
      // concurrent invocation. Best-effort cleanup — swallow.
    }
    throw e;
  }
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
    // Skip self-matches so `missing === cand` never dominates a genuinely close
    // alternative. Relying on the `applied ⇔ source changed` invariant to
    // suppress `replace X with X` downstream is fragile: a candidate at
    // distance 1 that would otherwise win never gets a chance if the loop
    // latches onto the self-match first.
    if (d === 0) continue;
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
 *   - **E0104** (undef-effect) — the effect namespace plus the standard
 *     effects, which no program declares and which the shared list therefore
 *     never held.
 * Adding either code back to *this* set silently corrupts the source: the
 * shared candidate list has no timer / variant entries, so `suggestName`
 * would propose an unrelated tile or reducer whose name happens to be close.
 */
const NAME_SUGGEST_CODES: ReadonlySet<string> = new Set([
  "E0102", // undef-reducer
  "E0103", // undef-ref / undef-slot
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
    // Every patch repairs exactly one diagnostic, so the position comes from
    // the loop and only the anchor is the branch's to choose.
    const add = (patch: Omit<AutoPatch, "anchor">): void => {
      patches.push({ ...patch, anchor: { kind: "span", pos: err.pos } });
    };
    const addAnchored = (anchor: PatchAnchor, patch: Omit<AutoPatch, "anchor">): void => {
      patches.push({ ...patch, anchor });
    };
    // For the repairs that add or extend a region elsewhere in the file, which
    // moves every line after it.
    const addElsewhere = (patch: Omit<AutoPatch, "anchor">): void => {
      patches.push({ ...patch, anchor: { kind: "region" } });
    };
    const beforePatches = patches.length;
    const beforeSkipped = skipped.length;
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
      const anchor = nameAnchor(store, err.pos, missing);
      addAnchored(anchor, {
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: applyNameFix(anchor, missing, suggested),
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
      const anchor = nameAnchor(store, err.pos, missing);
      addAnchored(anchor, {
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: applyNameFix(anchor, missing, suggested),
      });
    }
    if (err.code === "E0116") {
      // Message shape: `Call to undefined function "<name>"`. The candidate set
      // is the fn namespace plus the built-in calls — NOT every definition. A
      // slot or tile is in a different namespace, so proposing one produces
      // E0116 again at the same position: the patch fails the regression gate,
      // is rolled back, and the repair loop has spent a round on a name that
      // could never have resolved.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length === 0) {
        skip(err.code, "e0116-quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const fnNames = listDefs(store)
        .filter((e) => e.layer === "fn")
        .map((e) => e.name);
      const suggested = suggestNameFrom(calleeCandidates(fnNames, missing), missing);
      if (!suggested) {
        skip(err.code, "e0116-no-close-callee", err.message);
        continue;
      }
      add({
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        // Spliced at the reported column rather than at the line's first `\b`
        // match. Kumiki identifiers are kebab-case and `\b` matches at a `-`,
        // so `re-laod(laod(n))` has the first match inside `re-laod` — the
        // patch would rewrite a name that was never the one reported.
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0117") {
      // Message shape: `Reference to undefined type "<name>"`. The candidate
      // set is the type namespace — the program's own `type` definitions plus
      // the primitives, the standard library's domain types, and the generic
      // constructors. A slot or fn name would be E0117 again at the same
      // position, so the same namespace argument as E0116 applies.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length === 0) {
        skip(err.code, "e0117-quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const userTypes = listDefs(store)
        .filter((e) => e.layer === "type")
        .map((e) => e.name);
      const suggested = suggestNameFrom(typeCandidates(userTypes), missing);
      if (!suggested) {
        skip(err.code, "e0117-no-close-type", err.message);
        continue;
      }
      add({
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        // Column splice for the same reason as E0116: a type name may sit
        // inside a longer one on the same line (`Map(Text, Txt)`), and `\b`
        // would find the wrong occurrence.
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0104") {
      // Message shape: `Reference to undefined effect "<name>"`. The candidate
      // set is the effect namespace plus the standard effects the runtime
      // registers itself — a tile or slot whose name is close is E0104 again at
      // the same position, and the standard effects were reachable from no
      // candidate list at all, so `emit navigat(…)` had no proposal.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length === 0) {
        skip(err.code, "e0104-quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const candidates = listDefs(store)
        .filter((e) => e.layer === "effect")
        .map((e) => e.name)
        .concat([...BUILTIN_EFFECT_CAPS.keys()]);
      const suggested = suggestNameFrom(candidates, missing);
      if (!suggested) {
        skip(err.code, "e0104-no-close-effect", err.message);
        continue;
      }
      add({
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0118") {
      // Message shape: `Reference to undefined theme "<name>"`. The candidate
      // set is the two namespaces `app.theme` accepts — a `theme` definition,
      // or the slot whose value selects one. Every other layer would be E0118
      // again at the same position.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length === 0) {
        skip(err.code, "e0118-quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const candidates = listDefs(store)
        .filter((e) => e.layer === "theme" || e.layer === "slot")
        .map((e) => e.name);
      const suggested = suggestNameFrom(candidates, missing);
      if (!suggested) {
        skip(err.code, "e0118-no-close-theme", err.message);
        continue;
      }
      add({
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0216") {
      // Message shape: `Variant "<tag>" is not a member of type "<T>"` — the
      // constructor-side twin of E0209, and resolved the same way.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length < 2) {
        skip(err.code, "e0216-quoted-name-extract-failed", err.message);
        continue;
      }
      const missing = quoted[0]!;
      const tags = variantTagsOf(quoted[1]!, store.program);
      if (!tags || tags.length === 0) {
        skip(err.code, "e0216-unresolved-variant-type", err.message);
        continue;
      }
      const suggested = suggestNameFrom(tags, missing);
      if (!suggested) {
        skip(err.code, "e0216-no-close-tag", err.message);
        continue;
      }
      add({
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0209") {
      // Message shape: `Variant "<tag>" is not a member of scrutinee type "<T>"`.
      // Candidates are the union's tag list, not top-level defs. `<T>` may be
      // rendered as `Option(Int)` / `Result(Ok, Err)` / a plain `TypeRef` name;
      // `variantTagsOf` strips the generic argument list and resolves aliases.
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length < 2) {
        // Same family as the other `*-quoted-name-extract-failed` reasons —
        // a sudden spike across the family signals compiler message drift.
        skip(err.code, "e0209-quoted-name-extract-failed", err.message);
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
      const anchor = nameAnchor(store, err.pos, missing);
      addAnchored(anchor, {
        code: err.code,
        message: err.message,
        description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
        apply: applyNameFix(anchor, missing, suggested),
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
        // Named for the shared drift-detection family, even though this
        // branch parses a fixed phrase rather than a quoted name — a spike
        // across all `*-quoted-name-extract-failed` reasons is the signal.
        skip(err.code, "e0301-quoted-name-extract-failed", err.message);
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
      addElsewhere({
        code: err.code,
        message: err.message,
        description: `add capability "${cap}" to app.caps`,
        apply: (text: string) => appendAppCap(text, cap, appRange) ?? text,
      });
    }
    if (err.code === "E0001") {
      addElsewhere({
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
    if (err.code === "E0218") {
      // Message shape: `"for" iterates a List, but this is a <T> — iterate its
      // .<remedy>`. The repair is a suffix on the iterated expression, and the
      // diagnostic's position is where that expression starts — so this only
      // fires when the expression is a plain name whose end is unambiguous.
      // `for t in issues[$1].tags` reports at `issues`, and appending there
      // would produce `issues.keys[$1].tags`.
      const remedy = /iterate its (\.[a-z-]+)/.exec(err.message)?.[1];
      if (!remedy) {
        skip(err.code, "e0218-remedy-extract-failed", err.message);
        continue;
      }
      const name = identifierAt(store, err.pos);
      if (!name) {
        skip(err.code, "e0218-target-not-a-plain-name", err.message);
        continue;
      }
      add({
        code: err.code,
        message: err.message,
        description: `append "${remedy}" to "${name}" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => replaceAt(text, err.pos, name, `${name}${remedy}`),
      });
    }
    if (err.code === "E0119") {
      // The slot holds the current route and is in scope in every reducer, and
      // a reducer this fires in was never going to get a bind — so dropping the
      // `$` is the whole repair. The diagnostic points at the `$`, and
      // `replaceAt` writes only if that is what is there, so a drifted position
      // leaves the file alone.
      add({
        code: err.code,
        message: err.message,
        description: `read the "route" slot instead of "$route" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => replaceAt(text, err.pos, "$route", "route"),
      });
    }
    // Default classifier: this diagnostic code has no repair branch at all.
    // Distinct from `*-quoted-name-extract-failed` (which means "a branch
    // fired but the message shape didn't match") — `no-repair-branch` means
    // "planFixes doesn't know how to repair this code yet". AI loops can use
    // the difference to decide "extend the branch set" vs "compiler drift".
    if (patches.length === beforePatches && skipped.length === beforeSkipped) {
      skip(err.code, "no-repair-branch", err.message);
    }
  }
  return { patches, skipped };
}

/**
 * The order a plan may be composed in, by how much of the source each patch
 * disturbs (see `PatchAnchor`): every `span` first and from the right, then
 * every `line`, then every `region`. Within a tier the plan's own order is
 * kept, which for `line` matters: two repairs of the same misspelling on one
 * line each take the first remaining match.
 *
 * This is only about not invalidating the *positions* patches were measured
 * at. A diagnostic that no patch repairs still moves when a patch to its left
 * lands, and the regression gate — which compares `code@line:col` — still
 * calls the moved one introduced and rolls the plan back. Ordering cannot
 * reach that; only a position-independent identity could.
 */
const ANCHOR_TIER: Record<PatchAnchor["kind"], number> = { span: 0, line: 1, region: 2 };

function applicationOrder(patches: AutoPatch[]): AutoPatch[] {
  return [...patches].sort((a, b) => {
    const tier = ANCHOR_TIER[a.anchor.kind] - ANCHOR_TIER[b.anchor.kind];
    if (tier !== 0) return tier;
    if (a.anchor.kind !== "span" || b.anchor.kind !== "span") return 0;
    return b.anchor.pos.line - a.anchor.pos.line || b.anchor.pos.col - a.anchor.pos.col;
  });
}

export function planFixes(store: Store, errors: KumikiError[]): AutoPatch[] {
  return planFixesExplained(store, errors).patches;
}

/**
 * The diagnostics `fix` is about: the errors, never the warnings.
 *
 * A warning is advisory — `check` reports one and exits 0 — and no branch in
 * `planFixes` emits a patch for a warning code. `fix` is the only reader that
 * treated the two tiers alike, which is why a file `check` calls
 * `ok (1 warning)` came back from `fix` as "(no auto-patches available)".
 *
 * A `check()` here is read for one of three decisions, and each wants the
 * errors alone:
 *
 *  - what to repair, so a warning is not reported as an error nobody can fix;
 *  - whether to keep a repair. Filtering after the patch only would count a
 *    warning the file already had as one the patch introduced, and roll back a
 *    repair that fixed a real error;
 *  - whether the fix-from-test path may run its behavioural tier. That gate
 *    asks "does this file compile", so a warning anywhere in the file stopped
 *    `--auto-patch` repairing a failing test — and its second gate did the
 *    same after a compile repair had already landed.
 *
 * What the filter must not do is hide them. `advisory` is the other half, and
 * every result that leaves this file carries it: `FixPlan.warnings`,
 * `FixApplyResult.warnings`, `FixFromTestOutcome.warnings`. Every verdict
 * printed from those says how many, and lists them under whatever it said.
 */
function repairable(diagnostics: KumikiError[]): KumikiError[] {
  return diagnostics.filter((d) => d.severity !== "warning");
}

/**
 * The wording every verb uses for a count of advisory diagnostics.
 *
 * Exported and called by `check` and by the MCP tools rather than copied:
 * "the two verbs cannot disagree about a file neither of them will change" is
 * only true if one of them cannot be reworded without the other.
 */
export function plural(n: number): string {
  return `${n} warning${n === 1 ? "" : "s"}`;
}

/**
 * A headline plus the advisory count, when there is one. Every verdict `fix`
 * prints goes through here: the whole point is that two verbs cannot describe
 * one file differently, which a second spelling of this would reintroduce.
 */
function verdict(headline: string, warnings: KumikiError[]): string {
  return warnings.length > 0 ? `${headline} (${plural(warnings.length)})` : headline;
}

/** The warnings themselves, under whatever verdict or diagnostic list precedes them. */
function reportWarnings(warnings: KumikiError[]): void {
  for (const w of warnings) console.error(`${w.code} ${w.message}`);
}

/**
 * The fields every `applyFixPlan` return that left the file alone answers the
 * same way: nothing applied, `after` equal to `before`, and the warnings and
 * skip reasons the plan already typechecked. Spelled as a helper so a return
 * that wrote nothing cannot quietly claim the post-patch set instead.
 */
function nothingWritten(
  plan: FixPlan,
  before: string,
  approved = 0,
): {
  applied: 0;
  approved: number;
  before: string;
  after: string;
  warnings: KumikiError[];
  skipped: SkipReason[];
} {
  return {
    applied: 0,
    approved,
    before,
    after: before,
    warnings: plan.warnings,
    skipped: plan.skipped,
  };
}

/** The other half of the same split, kept beside it so neither drifts. */
function advisory(diagnostics: KumikiError[]): KumikiError[] {
  return diagnostics.filter((d) => d.severity === "warning");
}

/**
 * Pure planner: read + typecheck + planFixes (filtered by `onlyCode` when set).
 * No I/O beyond reading the file. Returned `patches` is empty when nothing is
 * repairable; `errors` carries every error either way — warnings excluded, see
 * `repairable` — so the caller can distinguish "clean file" from "errors but
 * nothing to auto-fix".
 */
export function planFix(
  path: string,
  onlyCode: string | undefined,
  capabilities: string[] = [],
): FixPlan {
  const store = load(path);
  const diagnostics = check(store.program, { capabilities });
  const errors = repairable(diagnostics);
  const warnings = advisory(diagnostics);
  if (errors.length === 0) return { errors, warnings, patches: [], skipped: [] };
  const { patches: all, skipped } = planFixesExplained(store, errors);
  const patches = onlyCode ? all.filter((p) => p.code === onlyCode) : all;
  return { errors, warnings, patches, skipped };
}

export type FixPlan = {
  /** Typecheck errors on `path`, warnings excluded. Empty when the file is clean. */
  errors: KumikiError[];
  /**
   * The advisory half of the same `check()`. Carried rather than dropped so a
   * caller reporting a clean file can still say what is in it — `fix` answering
   * "no errors" for a file `check` calls "ok (1 warning)" is the same wrong
   * answer as the one this split removes, told the other way round.
   */
  warnings: KumikiError[];
  /** Repairable subset, filtered by `onlyCode` when the caller passed it. */
  patches: AutoPatch[];
  /**
   * The diagnostics no patch covers, with the classifier for why. Every error
   * lands in exactly one of `patches` or `skipped`, so a caller that reports
   * only the patches is telling the reader the file has fewer problems than it
   * does. Not affected by `onlyCode` — a patch the caller filtered out was
   * still found.
   */
  skipped: SkipReason[];
};

/**
 * Apply the planned patches to `path`, re-typecheck the result, and return
 * before/after source plus the residual diagnostic set.
 *
 * The result carries two mutually-exclusive failure modifiers, each of which
 * pins `applied: 0` and leaves the on-disk file byte-identical:
 *  - `regressionBlocked`: the gate refused the write. `blocked` says which of
 *    its three conditions it was — the composed patches would introduce a
 *    diagnostic the pre-patch file did not have, they resolve none of the ones
 *    it did, or the composed source does not parse. The last also sets
 *    `parseError` and puts a synthetic `E0000` in `remaining`, so the
 *    empty-⇔-clean invariant holds for a caller that reads neither.
 *  - `writeError`: the composed patches passed the gate but the atomic write
 *    threw (EACCES / ENOSPC / EBUSY, …). Raw message preserved for the caller
 *    to render.
 *
 * Callers that need a dry preview should use `planFix` and apply
 * `patches[i].apply` themselves.
 */
export function applyFixPlan(
  path: string,
  onlyCode: string | undefined,
  capabilities: string[] = [],
): FixApplyResult {
  const plan = planFix(path, onlyCode, capabilities);
  const before = readFileSync(path, "utf8");
  if (plan.patches.length === 0) {
    return { ...nothingWritten(plan, before), remaining: plan.errors };
  }
  // Counted one patch at a time, because a patch can decline to change
  // anything: `replaceAt` returns the source untouched when the reported
  // column does not hold the name it was told to replace. Composed with
  // patches that do land, the regression gate passes on the strength of the
  // others and the no-op would still be reported as applied.
  let after = before;
  let applied = 0;
  for (const p of applicationOrder(plan.patches)) {
    const next = p.apply(after);
    if (next !== after) applied += 1;
    after = next;
  }
  if (applied === 0) {
    // Nothing changed, so there is nothing to gate and nothing to write. This
    // is "no auto-patch took effect", not a rollback — `regressionBlocked`
    // stays unset so the caller reports it as such.
    return { ...nothingWritten(plan, before), remaining: plan.errors };
  }
  // Regression gate. Every path that would touch disk first re-parses and
  // re-typechecks the composed source, then compares the two diagnostic
  // multisets by `diagnosticKey` rather than by count. Rollback triggers when
  // any of:
  //   1. The composed source no longer parses at all — a *parse-error* is
  //      strictly worse than the original type errors, so we discard even
  //      though the pre-patch file had errors.
  //   2. `after` holds a diagnostic `before` does not — introduced a new
  //      failure. Catches 1-for-1 swaps (E0301→E0302 via typo) that a
  //      count-only guard would miss. Warnings are outside the comparison in
  //      both directions, deliberately: a repair that clears an error and
  //      reveals an advisory diagnostic is still a repair, and rolling it back
  //      would leave the file holding the error to avoid holding the warning.
  //   3. Nothing from `before` was resolved — the composed source carries the
  //      same diagnostics the original did, so the patches changed text and
  //      improved nothing. A swap normally trips (2) instead, because the
  //      diagnostic that replaced the old one is one `before` did not have;
  //      this is the condition for a write with no diagnostic consequence at
  //      all.
  // Invariant: "apply => file is either strictly cleaner or unchanged".
  // Callers observe rollback via `applied === 0 && regressionBlocked === true`.
  // Parse and typecheck have distinct failure semantics: a parse-error is a
  // rollback (case 1), a `check()` throw is an internal typechecker bug that
  // must surface, not be silently reported as `parseError`. Keep the catches
  // separate — `check()` is not in the try.
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(lex(after));
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
      ...nothingWritten(plan, before),
      remaining: [...plan.errors, synthetic],
      regressionBlocked: true,
      blocked: { reason: "parse-error", message },
      parseError: message,
    };
  }
  // One typecheck, both halves. The errors decide the gate; the warnings are
  // what the file will be carrying once this write lands, which is not the set
  // it started with — a repair that resolves an undefined tile onto one that
  // cannot fire the event a reducer subscribes to reveals a warning that was
  // not there before.
  const afterDiagnostics = check(parsed, { capabilities });
  const dryRemaining = repairable(afterDiagnostics);
  const introduced = surplus(dryRemaining, plan.errors);
  const resolved = surplus(plan.errors, dryRemaining);
  if (introduced.length > 0 || resolved.length === 0) {
    return {
      ...nothingWritten(plan, before),
      remaining: plan.errors,
      regressionBlocked: true,
      blocked:
        introduced.length > 0 ? { reason: "introduced", introduced } : { reason: "resolved-none" },
    };
  }
  try {
    atomicWriteFileSync(path, after);
  } catch (e) {
    // Symmetric with the `parseError` / `regressionBlocked` short-circuit
    // above: I/O failure is a structured return, not a raw stack. The atomic
    // helper guarantees the on-disk file is unchanged on throw, so
    // `remaining` echoes the pre-patch diagnostics.
    // The gate approved these; the filesystem is what refused them. Passed as
    // an argument rather than spread over afterwards, so reordering the fields
    // cannot silently lose the count on the one path it exists for.
    return {
      ...nothingWritten(plan, before, applied),
      remaining: plan.errors,
      writeError: e instanceof Error ? e.message : String(e),
    };
  }
  return {
    applied,
    approved: applied,
    before,
    after,
    remaining: dryRemaining,
    warnings: advisory(afterDiagnostics),
    skipped: plan.skipped,
  };
}

export type FixApplyResult = {
  /** Number of patches actually applied. `0` when the file was already clean or nothing was auto-fixable. */
  applied: number;
  /**
   * The patches the regression gate approved. Equal to `applied` on every path
   * that reached disk, and `0` wherever the gate refused or there was nothing
   * to write. The two differ on exactly one path — a write that threw — where
   * nothing landed and this is what the filesystem refused.
   */
  approved: number;
  /** Source before writing. Equal to `after` when `applied === 0`. */
  before: string;
  /** Source after writing (already on disk). */
  after: string;
  /**
   * Residual errors after the write, warnings excluded. Empty ⇔ file is clean.
   * When the write produced unparseable source, this contains a synthetic
   * `E0000` parse-error so the empty-⇔-clean invariant holds without callers
   * needing to inspect `parseError` first.
   */
  remaining: KumikiError[];
  /**
   * The advisory half of the same typecheck — the diagnostics `fix` read and
   * decided not to act on. Required, so every path has to answer it: a path
   * that wrote nothing reports what the plan found, and the one that wrote
   * reports what the file carries now, which is not always the same set.
   */
  warnings: KumikiError[];
  /**
   * Raw parser message when the composed patches broke syntax. Duplicated by
   * the `E0000` entry in `remaining`; kept as a convenience field for
   * callers rendering a human message.
   */
  parseError?: string;
  /**
   * True when the regression gate rolled the write back and `applied` is `0`.
   * Absent means either the patch cleanly applied or there was nothing to
   * apply. `blocked` says which of the gate's two conditions it was.
   */
  regressionBlocked?: boolean;
  /**
   * Why the gate rolled back — one member per condition, so a reader never has
   * to consult a second field to learn which it was.
   *
   * `introduced` carries the diagnostics the composed source has that the
   * original did not, by `diagnosticKey` — so a diagnostic a repair only moved
   * is not one of them, and what is listed here is a failure the repair would
   * have created. Naming them is what lets a reader check that.
   *
   * `parse-error` is the composed source failing to lex or parse. It carries
   * its own message rather than deferring to `parseError`, because a consumer
   * reading only this field would otherwise be told the repair was pointless
   * when what happened was that a repair rule emitted source that does not
   * parse — the opposite conclusion, and a defect on the compiler's side.
   */
  blocked?:
    | { reason: "introduced"; introduced: KumikiError[] }
    | { reason: "resolved-none" }
    | { reason: "parse-error"; message: string };
  /**
   * Raw filesystem error message when the composed patches passed the
   * regression gate but the write threw (EACCES / ENOSPC / EBUSY, …). When
   * set, `applied === 0`, `after === before`, `remaining` carries the
   * pre-patch diagnostics, and the on-disk target file is byte-identical to
   * `before` — `atomicWriteFileSync` stages content in a sibling tmp file and
   * atomically renames it into place, so a throw at any stage leaves the
   * target untouched. Mutually exclusive with `parseError` and
   * `regressionBlocked` — those short-circuit before the write.
   */
  writeError?: string;
  /**
   * Why each unrepaired error got no patch, from the same plan the patches
   * came from. Carried so a caller reporting "nothing to apply" can say which
   * silent skip produced it without planning the file a second time — a second
   * plan would read the file again and could answer about a different one.
   */
  skipped: SkipReason[];
};

/**
 * What the regression gate reads a diagnostic as: its code, its kind, and its
 * message — **not** where it sits.
 *
 * Position is what a repair moves. A rewrite shorter than what it replaced
 * shifts every diagnostic to its right on that line, and a repair that inserts
 * lines (`E0001` prepends a tile) shifts every diagnostic below it. Keyed on
 * position, each of those reads as a diagnostic the composed source has and the
 * original did not — so the gate called an untouched diagnostic introduced and
 * rolled back a repair that was correct.
 *
 * The message is what distinguishes two diagnostics of one code. Counting
 * codes alone is *nearly* enough — a swap within one code leaves the count
 * unchanged, so the resolved-nothing condition below catches it — and it fails
 * exactly when a second repair balances the books: reword one `E0211` and
 * resolve one `E0119`, and the per-code counts say a clean repair happened
 * while the reworded diagnostic is still in the file.
 *
 * Normalising positions through each patch's edit instead was the other
 * option. It loses because a region patch's delta is the whole file, so every
 * patch would have to declare the span it touches for the gate to undo it.
 *
 * What this accepts: a repair that resolves one diagnostic while moving and
 * recreating another with the same wording elsewhere reads as no change at
 * all. No repair branch can produce it — every one substitutes a name that is
 * already declared, so none can mint a diagnostic with a message the file
 * already had.
 */
function diagnosticKey(e: KumikiError): string {
  return JSON.stringify([e.code, e.kind, e.message]);
}

/**
 * The entries of `a` that `b` does not account for, compared as **multisets**.
 *
 * A set would answer "nothing was resolved" for a file holding two
 * diagnostics with one key where a repair cleared one of them, and roll a real
 * repair back. Counting is what makes one of two a difference.
 *
 * Returns real diagnostics rather than keys, because the printer reports an
 * introduced one as `code@line:col` and the MCP wire serialises it whole. When
 * a key is over-represented, the earliest entries account for `b` and the
 * surplus is what is left at the end of `a`. Which of a set of identical
 * diagnostics gets reported is arbitrary — only the count carries meaning —
 * so the rule is stated rather than left to whichever way the loop runs.
 */
function surplus(a: readonly KumikiError[], b: readonly KumikiError[]): KumikiError[] {
  const budget = new Map<string, number>();
  for (const e of b) {
    const k = diagnosticKey(e);
    budget.set(k, (budget.get(k) ?? 0) + 1);
  }
  const extra: KumikiError[] = [];
  for (const e of a) {
    const k = diagnosticKey(e);
    const left = budget.get(k) ?? 0;
    if (left > 0) budget.set(k, left - 1);
    else extra.push(e);
  }
  return extra;
}

/**
 * The one sentence describing a write this gate refused, for whichever verb is
 * printing. Two verbs cannot describe one rollback differently if only one of
 * them spells it.
 *
 * Reads `blocked` alone, which carries one member per condition — so no branch
 * here depends on being asked before another.
 */
function rollbackLine(r: {
  blocked?: FixApplyResult["blocked"];
  regressionBlocked?: boolean;
}): string {
  switch (r.blocked?.reason) {
    case "parse-error":
      return `fixes broke the file: ${r.blocked.message}`;
    case "resolved-none":
      return "(auto-patch rolled back — it resolved none of the reported diagnostics)";
    case "introduced": {
      // Named rather than summarised as "new errors": these are diagnostics the
      // file would have gained, and the position is where the repair would have
      // put each one.
      const where = r.blocked.introduced
        .map((e) => `${e.code}@${e.pos.line}:${e.pos.col}`)
        .join(", ");
      return `(auto-patch rolled back — the re-check reported ${where}, which it did not before)`;
    }
    default:
      return r.regressionBlocked ? "(auto-patch rolled back)" : "(no auto-patches available)";
  }
}

/**
 * Print what `fix` found (and, with `apply`, what it wrote) and return the exit
 * code the caller should end on: `0` when the file is clean, `1` when errors
 * are still in it.
 *
 * Returned rather than assigned to `process.exitCode`, because the CLI is not
 * the only caller — tests drive this in-process, and a function that sets the
 * exit code as a side effect would fail the vitest worker that called it.
 */
export function fixCmd(
  path: string,
  apply: boolean,
  onlyCode?: string,
  capabilities: string[] = [],
): number {
  if (!apply) {
    const { errors, warnings, patches, skipped } = planFix(path, onlyCode, capabilities);
    if (errors.length === 0) {
      // Same shape `check` reports a clean-but-advisory file with, so the two
      // verbs cannot disagree about a file neither of them will change — and
      // the same shape `--apply` prints below, which changes it just as little.
      console.log(verdict("no errors", warnings));
      reportWarnings(warnings);
      return 0;
    }
    if (patches.length === 0) {
      console.log("(no auto-patches available)");
      for (const e of errors) console.error(`${e.code} ${e.message}`);
      // Under the errors, not instead of them: a file with both is one `check`
      // reports both for, and the branch that has an error to report is no
      // more entitled to drop the rest than the clean one above.
      reportWarnings(warnings);
      return 1;
    }
    for (const p of patches) {
      console.log(`${p.code} ${p.message}`);
      console.log(`  fix: ${p.description}`);
    }
    // A repair loop that sees only the repairable half applies it and calls the
    // file done. The `--apply` path already reports what survives; the dry run
    // has to say the same thing before anything is written.
    if (skipped.length > 0) {
      console.log(`(no auto-patch for ${skipped.length} of ${errors.length})`);
      // The kebab-case reason travels with the line: it is the stable half of
      // this output, and a repair loop deciding whether to retry or escalate
      // reads it rather than the prose.
      for (const s of skipped) console.error(`${s.code} ${s.message} [${s.reason}]`);
    }
    reportWarnings(warnings);
    // A dry run leaves every error where it found it, so the file is still
    // broken and `kumiki fix <f> && next-step` must not run `next-step`.
    return 1;
  }
  const result = applyFixPlan(path, onlyCode, capabilities);
  if (result.applied === 0) {
    if (result.writeError) {
      // The plan passed the regression gate but the on-disk write threw. Fail
      // loudly on stderr and exit non-zero — the pre-patch diagnostics survive
      // so scripts inspecting `remaining` still get the compile state, but the
      // I/O failure itself must not silently look like "no auto-patches".
      console.error(`could not write fixes to ${path}: ${result.writeError}`);
      return 1;
    }
    if (result.remaining.length === 0) {
      console.log(verdict("no errors", result.warnings));
      reportWarnings(result.warnings);
      return 0;
    }
    console.log(rollbackLine(result));
    for (const e of result.remaining) console.error(`${e.code} ${e.message}`);
    reportWarnings(result.warnings);
    return 1;
  }
  if (result.remaining.length === 0) {
    console.log(verdict(`applied ${result.applied} fix(es) — file now clean`, result.warnings));
    reportWarnings(result.warnings);
    return 0;
  }
  console.log(`applied ${result.applied} fix(es) — ${result.remaining.length} error(s) remain`);
  for (const e of result.remaining) console.error(`${e.code} ${e.message}`);
  reportWarnings(result.warnings);
  return 1;
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
 *   `compile-blocked` (apply: the regression gate refused the write) |
 *   `compile-remaining` (apply: still broken after Tier-1 write).
 *
 * Tier-2 covers the compiling file:
 *   `not-found` | `already-pass` | `no-patch` (no deterministic patch) |
 *   `proposed` (dry-run patch) | `applied` (patch written; carries `regressed`).
 *
 * Independent of tier: `write-failed` fires when a patch was chosen but
 * `atomicWriteFileSync` threw. `phase` (`compile` | `test`) picks the site,
 * `patch` is preserved on `phase: "test"` for retry / display, and the
 * on-disk file is byte-identical to before the call.
 */
type FixFromTestStatus =
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
       * no-patch outcome. Compile-tier: the first `planFixesExplained.skipped`
       * entry's reason, or `every-patch-declined` when there were no skips at
       * all — see `noCompilePatch`, which is why this is populated for every
       * compile-tier no-patch outcome. Behavioral tier: the tier planner's
       * bail reason. Test-runner threw: `test-runner-threw`.
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
      /**
       * The regression gate refused the Tier-1 write, so the file on disk is
       * byte-identical to before the call. Distinct from `no-patch`, which
       * means no repair was found at all: here one was, and applying it would
       * have left the file no cleaner. `compileErrors` is the author's own set
       * — the diagnostics the refused patch was offered for, never the ones it
       * would have created, which `blocked` names instead. `blocked` also says
       * which of the gate's three conditions refused it, including the one
       * where the composed source did not parse.
       */
      ok: false;
      status: "compile-blocked";
      compileErrors: KumikiError[];
      blocked: NonNullable<FixApplyResult["blocked"]>;
    }
  | {
      /**
       * The Tier-1 write landed and the file still does not compile. Syntax
       * breakage is not one of these: the gate rejects source that does not
       * parse before anything reaches disk, and reports it as
       * `compile-blocked`.
       */
      ok: false;
      status: "compile-remaining";
      compileFixes: number;
      compileErrors?: KumikiError[];
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
    }
  | {
      /**
       * A patch was chosen but `writeFileSync` threw before it could land.
       * `phase` distinguishes the two writes a fix-from-test run can make:
       *  - `"compile"`: Tier-1 compile patches passed the regression gate and
       *    the write itself threw. `compileFixes` is the count that would have
       *    landed; the on-disk file is byte-identical to before the call.
       *  - `"test"`: Tier-2 behavioral patch was selected. `patch` carries
       *    the proposed `AutoPatch` that never landed; `compileFixes` is
       *    present only when Tier-1 wrote successfully first.
       */
      ok: false;
      status: "write-failed";
      phase: "compile" | "test";
      writeError: string;
      compileFixes?: number;
      patch?: AutoPatch;
    };

/**
 * One of the statuses above, plus the advisory diagnostics from the last
 * typecheck this call ran.
 *
 * An intersection rather than a field repeated on nine members, so a status
 * added later cannot be the one that forgets it — and required rather than
 * optional, because an optional field is one nothing has to fill. The
 * behavioural tier replaces a string literal in a tile, so "the last
 * typecheck" is still the right description of what these describe after it.
 */
export type FixFromTestOutcome = FixFromTestStatus & {
  warnings: KumikiError[];
};

/**
 * Inverse of the lexer's string-body decoding
 * (packages/compiler/src/lexer.ts:123-147). Accepts the RAW inner body of a
 * `"..."` source literal (no surrounding quotes) and returns the decoded
 * runtime value. Escape set matches the lexer exactly: `\n \t \r \" \\`.
 *
 * Returns `null` when the body contains an escape sequence the lexer would
 * reject — defensive; the file has already been lexed so this branch is
 * unreachable in practice, but the caller treats `null` as "skip this literal
 * candidate" rather than throwing so a future refactor that breaks the
 * invariant fails soft (falling through to the tier's other bail paths).
 */
function decodeKumikiStringBody(raw: string): string | null {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const esc = raw[++i];
    if (esc === "n") out += "\n";
    else if (esc === "t") out += "\t";
    else if (esc === "r") out += "\r";
    else if (esc === '"') out += '"';
    else if (esc === "\\") out += "\\";
    else return null;
  }
  return out;
}

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
 * A deterministic patch from a failing test. Three tiers of relaxation over the
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
 * The Explained form returns either the same `AutoPatch` or a stable
 * kebab-case `reason` explaining why no tier produced a patch — the AI
 * iteration loop consumes it to distinguish "no deterministic repair exists"
 * from "compiler diagnostic format drifted". Every silent `return null` inside
 * the tier planners maps to one identifier here, and each early exit also
 * flows through `debugSkip` so `KUMIKI_DEBUG=fix` surfaces the same reason at
 * runtime. `excludedLineRanges` are the 1-based inclusive line spans of the
 * file's `test` definitions; matches inside them are skipped so a fixture
 * literal is never patched into passing. `store` is optional — without it,
 * the function degrades to the pre-relax exactly-one behavior for backward
 * compatibility with the existing external API.
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

/**
 * Backward-compatible wrapper returning only the patch (or `null`); new callers
 * that need the skip classifier should prefer `planTestPatchExplained`.
 */
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
 * Every `"..."` string literal in `source`, one pass. `start` / `end` are the
 * quote-inclusive source offsets; `body` is the raw inner slice (no quotes,
 * no decoding — callers that need the runtime string must call
 * `decodeKumikiStringBody`). Shared by `stringLiteralSpans` (needs only the
 * spans, to reject numeric hits landing inside a string) and the partial-
 * string tier (needs the decoded body to match the divergent middle), so the
 * `"(?:[^"\\]|\\.)*"` regex lives in exactly one place.
 */
export function iterStringLiterals(
  source: string,
): Array<{ start: number; end: number; body: string }> {
  const out: Array<{ start: number; end: number; body: string }> = [];
  const re = /"(?:[^"\\]|\\.)*"/g;
  let m: RegExpExecArray | null = re.exec(source);
  while (m !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({ start, end, body: m[0].slice(1, -1) });
    m = re.exec(source);
  }
  return out;
}

/**
 * True at offsets that sit inside a `"..."` string literal. Number / boolean
 * exact-literal searches must reject these so a leaf like `-1` doesn't get
 * matched against the substring `-1` inside a source string like `text="-1"`.
 * Cached per call via a closure — pre-scanning the whole source once beats
 * re-checking every candidate hit.
 */
function stringLiteralSpans(source: string): Array<[number, number]> {
  return iterStringLiterals(source).map((l) => [l.start, l.end]);
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
  // that composes with `inExcluded`. The `[lo, hi]` span is quote-inclusive,
  // so we reject only when the candidate sits *strictly* between the quotes
  // (`offset > lo && offset + len < hi`) — landing on a quote itself is
  // impossible for a numeric/boolean actualLit but the strict form documents
  // the "inside the body, not the quotes" intent for future readers.
  const isStringLeaf = typeof actual === "string";
  const spans = isStringLeaf ? null : stringLiteralSpans(source);
  const combinedExcluded = spans
    ? (offset: number): boolean =>
        inExcluded(offset) ||
        spans.some(([lo, hi]) => offset > lo && offset + actualLit.length < hi)
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
      anchor: { kind: "region" },
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
  // here we look for a string literal whose *decoded* body contains `midA`
  // as a substring. `midA` comes from `affixDiff` over `TestResult.leaf`,
  // which is already decoded (`\n` → real NL, `\"` → `"`, …), so we must
  // decode each literal body before comparing — otherwise a raw source
  // `"a\nb"` mismatches a `midA` containing a real newline and the tier
  // silently bails. The splice and re-encode also happen in decoded space
  // to keep un-touched escapes canonical (raw source `\n` round-trips as a
  // single `\n`, not as `\\n`).
  type Match = { start: number; end: number; body: string }; // body is DECODED
  const matches: Match[] = [];
  for (const lit of iterStringLiterals(source)) {
    if (inExcluded(lit.start)) continue;
    const decoded = decodeKumikiStringBody(lit.body);
    // `decoded === null` is defensively unreachable (source already lexed).
    // Skip such candidates rather than throw so the tier's other bail paths
    // still get considered if the invariant ever breaks. Emit a debug line
    // under `KUMIKI_DEBUG=fix` so a broken decoder is loud, not silent —
    // matches how the other tiers report their bail paths.
    if (decoded === null) {
      // Slice within the literal's own bounds so the debug payload never
      // spills past the closing quote into unrelated source.
      const snippet = source.slice(lit.start, Math.min(lit.end, lit.start + 40));
      debugSkip("planPartialStringPatch", "decoder-returned-null", snippet);
      continue;
    }
    if (decoded.includes(midA)) {
      matches.push({ start: lit.start, end: lit.end, body: decoded });
    }
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
  // Defensive — `matches` was filtered by `m[0].includes(midA)`, so `midA` is
  // guaranteed to be a substring of `target.body`. Kept so a future refactor
  // that breaks that invariant lights up under `KUMIKI_DEBUG=fix` instead of
  // returning a silently-wrong patch.
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
      anchor: { kind: "region" },
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
  // `stmtRe` requires `-?\d+`, so `parseInt` is always finite — but the lexer
  // accepts arbitrary-length digit sequences, so a source like `count + <20
  // digits>` reaches here with a non-safe integer that the JS number
  // arithmetic below (`actual - delta`, `expected / base`) would silently
  // round, producing a garbage splice. This bail is genuinely reachable from
  // the top-level API (see the corresponding test) and keeps the "cleaner or
  // unchanged" invariant intact.
  if (!Number.isSafeInteger(n)) return { patch: null, reason: "non-safe-integer-operand" };
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
    // Defensive — `newOp+newN === op+n` implies `wantedDelta === delta` which
    // implies `expected === actual`, already rejected by the top-level guard.
    // Kept so a future path that skips the guard trips this instead of writing
    // an identity patch.
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
  // Defensive — the same `stmtRe` matched inside `red.body` (a slice of
  // `store.lines`), so a walk over `source` must find it again within the
  // reducer's line range. Kept as a `debugSkip` site in case the line-range
  // computation drifts from what `reducersWritingSlot` used.
  if (!sourceMatch) return { patch: null, reason: "arithmetic-splice-target-lost" };
  const start = sourceMatch.index;
  const end = start + sourceMatch[0].length;
  return {
    patch: {
      code: "TEST",
      message: `test "${r.name}" failed at ${at}`,
      description: newDesc,
      apply: (text: string) => text.slice(0, start) + newLine + text.slice(end),
      anchor: { kind: "region" },
    },
  };
}

/**
 * Tier 1's "nothing was repaired" outcome, and the reason it was not.
 *
 * The first skip reason lets an AI loop distinguish "no auto-repairable code
 * fired" from "the compiler message drifted and every quoted-name branch fell
 * through". Every error lands in `patches` or `skipped`, and an error that
 * matched no branch at all is skipped as `no-repair-branch` — so an empty
 * `skipped` means the opposite of no repair: every error had a patch, and
 * every patch declined to change the source it was pointed at. That is its own
 * classifier rather than a missing one, which is what keeps `reason` populated
 * for every compile-tier no-patch outcome.
 */
function noCompilePatch(
  compileErrors: KumikiError[],
  skipped: SkipReason[],
): Extract<FixFromTestStatus, { status: "no-patch" }> {
  return {
    ok: false,
    status: "no-patch",
    compileErrors,
    reason: skipped[0]?.reason ?? "every-patch-declined",
  };
}

/**
 * Two-tier fix-from-test. Tier 1 clears compile errors with `applyFixPlan` so
 * the test can run; Tier 2 applies a deterministic literal repair from the failing
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
  const firstPass = check(store.program, { capabilities });
  const compileErrors = repairable(firstPass);
  // Replaced by whatever the Tier-1 repair last typechecked, so whichever
  // outcome this reaches describes the file as of the newest read it made.
  let warnings = advisory(firstPass);
  /**
   * Attach them. Every return goes through here rather than repeating the
   * field twelve times — and the field is required on the outcome, so a
   * thirteenth that skipped this would not compile.
   */
  const stamp = <T extends FixFromTestStatus>(o: T): T & { warnings: KumikiError[] } => ({
    ...o,
    warnings,
  });
  let compileFixes = 0;
  if (compileErrors.length > 0) {
    if (!apply) {
      // The dry run proposes; `compileFixes` is the planned count here, which
      // is the honest number for something that has not been applied.
      const { patches, skipped } = planFixesExplained(store, compileErrors);
      if (patches.length === 0) return stamp(noCompilePatch(compileErrors, skipped));
      return stamp({
        ok: true,
        status: "compile-proposed",
        compileFixes: patches.length,
        compilePatches: patches,
      });
    }
    // The same write every other `fix --apply` makes, through the same
    // regression gate: composed, re-parsed, re-typechecked, and rolled back
    // unless the file comes out strictly cleaner. One gate and one write, so a
    // repair this verb accepts is one `fix --apply` would accept — and an
    // error a repair creates can never be reported to the author as their own.
    const result = applyFixPlan(path, undefined, capabilities);
    warnings = result.warnings;
    if (result.applied === 0) {
      if (result.writeError !== undefined) {
        // The gate passed and the write threw: nothing landed, and the count
        // is what would have. `phase: "compile"` keeps the printer and the MCP
        // serialiser from heading it "applied N compile fix(es)".
        return stamp({
          ok: false,
          status: "write-failed",
          phase: "compile",
          writeError: result.writeError,
          compileFixes: result.approved,
        });
      }
      if (result.blocked !== undefined) {
        return stamp({
          ok: false,
          status: "compile-blocked",
          compileErrors,
          blocked: result.blocked,
        });
      }
      return stamp(noCompilePatch(compileErrors, result.skipped));
    }
    compileFixes = result.applied;
    if (result.remaining.length > 0) {
      return stamp({
        ok: false,
        status: "compile-remaining",
        compileFixes,
        compileErrors: result.remaining,
      });
    }
  }

  // Run the tests on the (now-compiling) file.
  let before: TestResult[];
  try {
    before = await testFile(path, capabilities);
  } catch (e) {
    return stamp({
      ok: false,
      status: "no-patch",
      testRunError: e instanceof Error ? e.message : String(e),
      // Classify test-run failures under the same family as Tier-3 skips so
      // an AI loop tallying `outcome.reason` can distinguish "the runner
      // itself blew up" from "the file compiles but no patch applies".
      reason: "test-runner-threw",
      ...(compileFixes ? { compileFixes } : {}),
    });
  }
  const target = before.find((r) => r.name === testName);
  if (!target) {
    return stamp({
      ok: false,
      status: "not-found",
      availableTests: before.map((r) => r.name),
      ...(compileFixes ? { compileFixes } : {}),
    });
  }
  if (target.pass) {
    return stamp({
      ok: true,
      status: "already-pass",
      pass: true,
      ...(compileFixes ? { compileFixes } : {}),
    });
  }

  // Tier 2: behavioral, deterministic literal repair. Re-load from the current
  // (possibly Tier-1-patched) file so the source, the `test` body line ranges
  // used to exclude fixture literals, and the scope-aware disambiguation store
  // are all consistent.
  const curSource = readFileSync(path, "utf8");
  const curStore = load(path);
  const attempt = planTestPatchExplained(curSource, target, testBodyLineRanges(curStore), curStore);
  if (!attempt.patch) {
    return stamp({
      ok: false,
      status: "no-patch",
      failingTest: target,
      reason: attempt.reason,
      ...(compileFixes ? { compileFixes } : {}),
    });
  }
  const patch = attempt.patch;
  if (!apply) {
    return stamp({
      ok: true,
      status: "proposed",
      patch,
      ...(compileFixes ? { compileFixes } : {}),
    });
  }
  // Apply the patch OUTSIDE the try — a throw from `patch.apply` (codegen /
  // slice-index bug in the tier planner, or a downstream regression in
  // `kumikiStringLit`) is a program bug, not an I/O failure. It must not
  // land in the `write-failed` variant, which is reserved for filesystem
  // errors the caller can act on (retry, elevate permissions, free space).
  const patched = patch.apply(curSource);
  try {
    atomicWriteFileSync(path, patched);
  } catch (e) {
    return stamp({
      ok: false,
      status: "write-failed",
      phase: "test",
      writeError: e instanceof Error ? e.message : String(e),
      patch,
      ...(compileFixes ? { compileFixes } : {}),
    });
  }
  const after = await testFile(path, capabilities);
  const nowPass = after.find((r) => r.name === testName)?.pass === true;
  const regressed = after
    .filter((r) => !r.pass && before.find((b) => b.name === r.name)?.pass === true)
    .map((r) => r.name);
  return stamp({
    ok: nowPass && regressed.length === 0,
    status: "applied",
    pass: nowPass,
    patch,
    // Always populated: `[]` means "checked, none regressed" — never absent
    // on the `applied` branch. Baked into the type by the discriminated union.
    regressed,
    ...(compileFixes ? { compileFixes } : {}),
  });
}

export async function fixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  const outcome = await runFixFromTest(path, testName, apply, capabilities);
  printFixFromTest(outcome, testName, path);
  // Under whatever the printer said, on every branch. The switch returns from
  // inside each case, so this is the one place that reaches all of them — and
  // an outcome's warnings are worth the same on the branch that repaired the
  // file as on the branch that gave up.
  reportWarnings(outcome.warnings);
  return outcome;
}

/**
 * Human-readable print of a `runFixFromTest` outcome. `path` is only used by
 * the `write-failed` branch so a user staring at "could not write compile fix"
 * can identify the affected file at a glance.
 */
function printFixFromTest(outcome: FixFromTestOutcome, testName: string, path?: string): void {
  // Applied-tier-1 header: only when Tier-1 patches were *written* — i.e. the
  // apply path. `compile-proposed` also carries `compileFixes` (the count of
  // proposed patches), but printing "applied N" for it would lie about a
  // dry-run.
  // `compile-blocked` is the one member with no `compileFixes` — a refusal
  // wrote nothing, so it has no count to report — which is why it is tested
  // first rather than left to the `> 0` guard: without it the next line does
  // not typecheck.
  if (
    outcome.status !== "compile-blocked" &&
    outcome.compileFixes !== undefined &&
    outcome.compileFixes > 0 &&
    outcome.status !== "compile-remaining" &&
    outcome.status !== "compile-proposed" &&
    // `write-failed` with `phase: "compile"` carries the count the gate
    // approved — nothing landed on disk, so the "applied N" header would lie.
    // On `phase: "test"` the Tier-1 write did land; header is honest.
    !(outcome.status === "write-failed" && outcome.phase === "compile")
  ) {
    console.log(
      verdict(
        `applied ${outcome.compileFixes} compile fix(es) — file now compiles`,
        outcome.warnings,
      ),
    );
  }
  switch (outcome.status) {
    case "no-patch": {
      // Unified `  reason: <slug>` output across all three sub-branches so
      // machine parsers can grep one shape. Historical form ` [reason]` was
      // dropped to avoid three-way format skew.
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
        if (outcome.reason) console.error(`  reason: ${outcome.reason}`);
        return;
      }
      if (outcome.failingTest) {
        const t = outcome.failingTest;
        console.log(`(no auto-patch available) for failing test "${testName}":`);
        if (t.expected !== undefined) console.log(`  expected: ${t.expected}`);
        if (t.actual !== undefined) console.log(`  actual:   ${t.actual}`);
        if (t.diffAt !== undefined) console.log(`  diff at:  ${t.diffAt}`);
        if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
        return;
      }
      console.log(`(no auto-patch available) for "${testName}"`);
      if (outcome.reason) console.log(`  reason: ${outcome.reason}`);
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
    case "compile-blocked": {
      // The same sentence `fix --apply` prints for the same refusal, from the
      // same function — a repair `fix` declines and `--auto-patch` accepts is
      // the disagreement this verb is not allowed to have.
      console.log(rollbackLine({ ...outcome, regressionBlocked: true }));
      console.log(
        `test "${testName}" is still blocked by ${outcome.compileErrors.length} compile error(s):`,
      );
      for (const e of outcome.compileErrors) console.error(`  ${e.code} ${e.message}`);
      return;
    }
    case "compile-remaining": {
      const n = outcome.compileFixes ?? 0;
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
      console.log(verdict(`test "${testName}" passes — nothing to fix`, outcome.warnings));
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
      console.log(
        verdict(
          `applied fix — test "${testName}" now ${nowPass ? "PASSES" : "still FAILS"}`,
          outcome.warnings,
        ),
      );
      if (outcome.regressed && outcome.regressed.length > 0) {
        console.log(
          `  WARNING: ${outcome.regressed.length} other test(s) regressed: ${outcome.regressed.join(", ")}`,
        );
      }
      return;
    }
    case "write-failed": {
      const what = outcome.phase === "compile" ? "compile fix" : "test patch";
      const where = path ? ` (${path})` : "";
      console.error(`could not write ${what} for "${testName}"${where}: ${outcome.writeError}`);
      return;
    }
    default: {
      // Exhaustiveness guard: adding a new variant to `FixFromTestOutcome`
      // without a matching case here is a TS compile error.
      const _exhaustive: never = outcome;
      throw new Error(`unhandled FixFromTestOutcome status: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
