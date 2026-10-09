import { readFileSync } from "node:fs";
import type { AppDef, KumikiError, Pos, Program, TestDef, Token } from "@kumikijs/compiler";
import {
  BUILTIN_EFFECT_CAPS,
  calleeCandidates,
  check,
  collectTimerNames,
  LexError,
  lex,
  nearestName,
  ParseError,
  parse,
  servesNotFound,
  typeCandidates,
  variantTagsOf,
} from "@kumikijs/compiler";
import type { TestResult } from "@kumikijs/runtime";
import { runTestsSource, testFile } from "./smoke.ts";
import { directDeps, listDefs, load, type Store } from "./store.ts";
import { atomicWriteFileSync } from "./write-lock.ts";

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
  anchor: PatchAnchor;
};

export type SkipReason = {
  code: string;
  reason: string;
  message: string;
};

function debugFixEnabled(): boolean {
  const v = process.env.KUMIKI_DEBUG;
  if (!v) return false;
  return v
    .split(",")
    .map((s) => s.trim())
    .includes("fix");
}

function debugSkip(where: string, reason: string, detail?: string): void {
  if (!debugFixEnabled()) return;
  console.warn(`[kumiki fix] skip ${where}: ${reason}${detail ? ` — ${detail}` : ""}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function replaceAt(text: string, pos: Pos, missing: string, replacement: string): string {
  const span = lineSpan(text, pos.line);
  if (!span) return text;
  const at = span.start + pos.col - 1;
  if (at + missing.length > span.end) return text;
  if (text.slice(at, at + missing.length) !== missing) return text;
  return text.slice(0, at) + replacement + text.slice(at + missing.length);
}

const OPENING = new Set(["(", "[", "{"]);
const CLOSING = new Set([")", "]", "}"]);

function removeNamedArg(text: string, pos: Pos, name: string): string {
  const offset = (p: Pos): number | null => {
    const span = lineSpan(text, p.line);
    return span ? span.start + p.col - 1 : null;
  };
  let tokens: Token[];
  try {
    tokens = lex(text);
  } catch {
    return text;
  }
  const at = tokens.findIndex((t) => t.pos.line === pos.line && t.pos.col === pos.col);
  const nameTok = tokens[at];
  const eq = tokens[at + 1];
  if (nameTok?.kind !== "ident" && nameTok?.kind !== "kw") return text;
  if (nameTok.value !== name || eq?.kind !== "op" || eq.value !== "=") return text;
  let depth = 0;
  let stop: Token | undefined;
  for (const t of tokens.slice(at + 2)) {
    if (t.kind !== "op") continue;
    if (OPENING.has(t.value)) depth += 1;
    else if (CLOSING.has(t.value) && depth > 0) depth -= 1;
    else if (CLOSING.has(t.value) || (t.value === "," && depth === 0)) {
      stop = t;
      break;
    }
  }
  const start = offset(pos);
  const stopAt = stop && offset(stop.pos);
  if (start === null || !stop || stopAt == null) return text;
  if (stop.kind === "op" && stop.value === ",") {
    // `name=…, next` → `next`, keeping whatever precedes the argument.
    const gap = /^[ \t]*/.exec(text.slice(stopAt + 1))?.[0].length ?? 0;
    return text.slice(0, start) + text.slice(stopAt + 1 + gap);
  }
  const comma = tokens[at - 1];
  const commaAt = comma && offset(comma.pos);
  if (comma?.kind !== "op" || comma.value !== "," || commaAt == null) return text;
  const valueEnd = start + text.slice(start, stopAt).trimEnd().length;
  return text.slice(0, commaAt) + text.slice(valueEnd);
}

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

function suggestNameFrom(candidates: Iterable<string>, missing: string): string | null {
  return nearestName(missing, candidates);
}

function suggestName(store: Store, missing: string): string | null {
  return suggestNameFrom(
    listDefs(store).map((e) => e.name),
    missing,
  );
}

function appendToAppClause(
  text: string,
  field: "caps" | "routes",
  entry: string,
  present: (app: AppDef) => boolean,
): string | null {
  let tokens: Token[];
  let program: Program;
  try {
    tokens = lex(text);
    program = parse(tokens);
  } catch (e) {
    if (e instanceof LexError || e instanceof ParseError) return null;
    throw e;
  }
  const index = program.defs.findIndex((d) => d.kind === "AppDef");
  const app = program.defs[index];
  if (app?.kind !== "AppDef" || present(app)) return null;
  const tokenAt = (p: Pos): number =>
    tokens.findIndex((t) => t.pos.line === p.line && t.pos.col === p.col);
  const next = program.defs[index + 1];
  const from = tokenAt(app.pos);
  const to = next ? tokenAt(next.pos) : tokens.length - 1;
  if (from === -1 || to === -1) return null;
  let open = -1;
  let depth = 0;
  for (let i = from; i < to; i++) {
    const t = tokens[i]!;
    if (t.kind === "op" && OPENING.has(t.value)) depth += 1;
    else if (t.kind === "op" && CLOSING.has(t.value)) depth -= 1;
    else if (depth === 0 && t.kind === "ident" && t.value === field) {
      const eq = tokens[i + 1];
      if (eq?.kind === "op" && eq.value === "=") open = i + 2;
    }
  }
  if (open === -1) return null;
  // The bracket that closes it. The text parsed, so there is one.
  let close = open + 1;
  for (depth = 0; close < tokens.length; close++) {
    const t = tokens[close]!;
    if (t.kind !== "op") continue;
    if (OPENING.has(t.value)) depth += 1;
    else if (CLOSING.has(t.value)) {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  const last = tokens[close - 1]!;
  const line = lineSpan(text, last.pos.line);
  if (last.kind === "eof" || !line) return null;
  const start = line.start + last.pos.col - 1;
  const empty = close - 1 === open;
  const at = start + (empty ? 1 : tokenLength(text, last, start));
  return `${text.slice(0, at)}${empty ? entry : `, ${entry}`}${text.slice(at)}`;
}

function appendAppCap(text: string, cap: string): string | null {
  return appendToAppClause(text, "caps", cap, (app) => app.caps.includes(cap));
}

function append404Route(text: string): string | null {
  return appendToAppClause(text, "routes", `"/404" -> NotFound`, (app) =>
    servesNotFound(app.routes),
  );
}

const NAME_SUGGEST_CODES: ReadonlySet<string> = new Set([
  "E0102", // undef-reducer
  "E0103", // undef-ref / undef-slot
  "E0105", // undef-tile
  "E0107", // undef-motion
  "E0211", // undef-tile-in-selector
]);

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
    const add = (patch: Omit<AutoPatch, "anchor">): void => {
      patches.push({ ...patch, anchor: { kind: "span", pos: err.pos } });
    };
    const addAnchored = (anchor: PatchAnchor, patch: Omit<AutoPatch, "anchor">): void => {
      patches.push({ ...patch, anchor });
    };
    const addElsewhere = (patch: Omit<AutoPatch, "anchor">): void => {
      patches.push({ ...patch, anchor: { kind: "region" } });
    };
    const beforePatches = patches.length;
    const beforeSkipped = skipped.length;
    if (NAME_SUGGEST_CODES.has(err.code)) {
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
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0117") {
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
        apply: (text: string) => replaceAt(text, err.pos, missing, suggested),
      });
    }
    if (err.code === "E0104") {
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
      const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
      if (quoted.length < 2) {
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
      const capMatch = /requires capability "([^"]+)"/.exec(err.message);
      if (!capMatch) {
        skip(err.code, "e0301-quoted-name-extract-failed", err.message);
        continue;
      }
      const cap = capMatch[1]!;
      if (!store.defs.some((e) => e.def.kind === "AppDef")) {
        skip(err.code, "e0301-no-app-def", err.message);
        continue;
      }
      const dryRun = appendAppCap(store.source, cap);
      if (dryRun === null) {
        skip(err.code, "e0301-cap-already-present-or-no-caps-field", err.message);
        continue;
      }
      addElsewhere({
        code: err.code,
        message: err.message,
        description: `add capability "${cap}" to app.caps`,
        apply: (text: string) => appendAppCap(text, cap) ?? text,
      });
    }
    if (err.code === "E0001") {
      const app = store.program.defs.find((d): d is AppDef => d.kind === "AppDef");
      const routes = app?.routes ?? [];
      if (routes.some((r) => r.path === "/404") && !servesNotFound(routes)) {
        skip(err.code, "e0001-404-is-a-redirect", err.message);
        continue;
      }
      if (append404Route(store.source) === null) {
        skip(err.code, "e0001-no-routes-clause", err.message);
        continue;
      }
      const defined = store.byQName.has("tile.NotFound");
      addElsewhere({
        code: err.code,
        message: err.message,
        description: defined
          ? `add "/404" -> NotFound to app.routes`
          : `add "/404" -> NotFound to app.routes, and define tile NotFound`,
        apply: (text: string) => {
          const routed = append404Route(text);
          if (routed === null) return text;
          return defined ? routed : `\ntile NotFound = page(heading("404"))\n${routed}`;
        },
      });
    }
    if (err.code === "E0218") {
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
      add({
        code: err.code,
        message: err.message,
        description: `read the "route" slot instead of "$route" at ${err.pos.line}:${err.pos.col}`,
        apply: (text: string) => replaceAt(text, err.pos, "$route", "route"),
      });
    }
    if (err.code === "E0129") {
      if (err.unrendered === "text-prop") {
        add({
          code: err.code,
          message: err.message,
          description: `make the text= value the positional content at ${err.pos.line}:${err.pos.col}`,
          apply: (text: string) => replaceAt(text, err.pos, "text=", ""),
        });
        continue;
      }
      if (err.unrendered === "text-shadowed") {
        add({
          code: err.code,
          message: err.message,
          description: `remove the text= argument the positional one shadows at ${err.pos.line}:${err.pos.col}`,
          apply: (text: string) => removeNamedArg(text, err.pos, "text"),
        });
        continue;
      }
      skip(err.code, "e0129-dropped-argument-has-no-single-repair", err.message);
      continue;
    }
    if (err.code === "E0124") {
      skip(err.code, "e0124-type-arguments-unknown", err.message);
      continue;
    }
    if (patches.length === beforePatches && skipped.length === beforeSkipped) {
      skip(err.code, "no-repair-branch", err.message);
    }
  }
  return { patches, skipped };
}

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

function repairable(diagnostics: KumikiError[]): KumikiError[] {
  return diagnostics.filter((d) => d.severity !== "warning");
}

export function plural(n: number): string {
  return `${n} warning${n === 1 ? "" : "s"}`;
}

function verdict(headline: string, warnings: KumikiError[]): string {
  return warnings.length > 0 ? `${headline} (${plural(warnings.length)})` : headline;
}

/** The warnings themselves, under whatever verdict or diagnostic list precedes them. */
function reportWarnings(warnings: KumikiError[]): void {
  for (const w of warnings) console.error(`${w.code} ${w.message}`);
}

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
  warnings: KumikiError[];
  /** Repairable subset, filtered by `onlyCode` when the caller passed it. */
  patches: AutoPatch[];
  skipped: SkipReason[];
};

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
  let after = before;
  let applied = 0;
  for (const p of applicationOrder(plan.patches)) {
    const next = p.apply(after);
    if (next !== after) applied += 1;
    after = next;
  }
  if (applied === 0) {
    return { ...nothingWritten(plan, before), remaining: plan.errors };
  }
  const gate = gateComposed(plan.errors, after, capabilities);
  if (gate.blocked !== undefined) {
    return {
      ...nothingWritten(plan, before),
      remaining: gate.remaining,
      regressionBlocked: true,
      blocked: gate.blocked,
      ...(gate.blocked.reason === "parse-error" ? { parseError: gate.blocked.message } : {}),
    };
  }
  try {
    atomicWriteFileSync(path, after);
  } catch (e) {
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
    remaining: gate.remaining,
    warnings: gate.warnings,
    skipped: plan.skipped,
  };
}

export type GateVerdict =
  | { blocked?: undefined; remaining: KumikiError[]; warnings: KumikiError[] }
  | { blocked: NonNullable<FixApplyResult["blocked"]>; remaining: KumikiError[] };

export function gateComposed(
  errors: KumikiError[],
  after: string,
  capabilities: string[] = [],
): GateVerdict {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(lex(after));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const pe = e as { pos?: { line: number; col: number } };
    const synthetic: KumikiError = {
      code: "E0000",
      kind: "parse-error",
      message,
      pos: { line: pe.pos?.line ?? 0, col: pe.pos?.col ?? 0 },
    };
    return { blocked: { reason: "parse-error", message }, remaining: [...errors, synthetic] };
  }
  const diagnostics = check(parsed, { capabilities });
  const remaining = repairable(diagnostics);
  const introduced = surplus(remaining, errors);
  if (introduced.length > 0)
    return { blocked: { reason: "introduced", introduced }, remaining: errors };
  if (surplus(errors, remaining).length === 0) {
    return { blocked: { reason: "resolved-none" }, remaining: errors };
  }
  return { remaining, warnings: advisory(diagnostics) };
}

export type FixApplyResult = {
  /** Number of patches actually applied. `0` when the file was already clean or nothing was auto-fixable. */
  applied: number;
  approved: number;
  /** Source before writing. Equal to `after` when `applied === 0`. */
  before: string;
  /** Source after writing (already on disk). */
  after: string;
  remaining: KumikiError[];
  warnings: KumikiError[];
  parseError?: string;
  regressionBlocked?: boolean;
  blocked?:
    | { reason: "introduced"; introduced: KumikiError[] }
    | { reason: "resolved-none" }
    | { reason: "parse-error"; message: string };
  writeError?: string;
  skipped: SkipReason[];
};

function diagnosticKey(e: KumikiError): string {
  return JSON.stringify([e.code, e.kind, e.message]);
}

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

export function rollbackLine(r: {
  blocked?: FixApplyResult["blocked"];
  regressionBlocked?: boolean;
}): string {
  switch (r.blocked?.reason) {
    case "parse-error":
      return `fixes broke the file: ${r.blocked.message}`;
    case "resolved-none":
      return "(auto-patch rolled back — it resolved none of the reported diagnostics)";
    case "introduced": {
      const where = r.blocked.introduced
        .map((e) => `${e.code}@${e.pos.line}:${e.pos.col}`)
        .join(", ");
      return `(auto-patch rolled back — the re-check reported ${where}, which it did not before)`;
    }
    default:
      return r.regressionBlocked ? "(auto-patch rolled back)" : "(no auto-patches available)";
  }
}

export function fixCmd(
  path: string,
  apply: boolean,
  onlyCode?: string,
  capabilities: string[] = [],
): number {
  if (!apply) {
    const { errors, warnings, patches, skipped } = planFix(path, onlyCode, capabilities);
    if (errors.length === 0) {
      console.log(verdict("no errors", warnings));
      reportWarnings(warnings);
      return 0;
    }
    if (patches.length === 0) {
      console.log("(no auto-patches available)");
      for (const e of errors) console.error(`${e.code} ${e.message}`);
      reportWarnings(warnings);
      return 1;
    }
    for (const p of patches) {
      console.log(`${p.code} ${p.message}`);
      console.log(`  fix: ${p.description}`);
    }
    if (skipped.length > 0) {
      console.log(`(no auto-patch for ${skipped.length} of ${errors.length})`);
      for (const s of skipped) console.error(`${s.code} ${s.message} [${s.reason}]`);
    }
    reportWarnings(warnings);
    return 1;
  }
  const result = applyFixPlan(path, onlyCode, capabilities);
  if (result.applied === 0) {
    if (result.writeError) {
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
      status: "compile-blocked";
      compileErrors: KumikiError[];
      blocked: NonNullable<FixApplyResult["blocked"]>;
    }
  | {
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
      ok: true;
      status: "applied";
      pass: true;
      patch: AutoPatch;
      regressed: [];
      compileFixes?: number;
    }
  | {
      ok: false;
      status: "test-blocked";
      patch: AutoPatch;
      blocked: TestPatchBlock;
      compileFixes?: number;
    }
  | {
      ok: false;
      status: "write-failed";
      phase: "compile" | "test";
      writeError: string;
      compileFixes?: number;
      patch?: AutoPatch;
    };

export type TestPatchBlock =
  | Extract<NonNullable<FixApplyResult["blocked"]>, { reason: "parse-error" | "introduced" }>
  | { reason: "test-runner-threw"; message: string }
  | { reason: "named-test-missing" }
  | { reason: "still-fails"; failingTest: TestResult }
  | { reason: "regressed"; regressed: string[] };

export type FixFromTestOutcome = FixFromTestStatus & {
  warnings: KumikiError[];
};

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

/** The kind of the `test` definition named `testName`, if the file has one. */
function testKindOf(store: Store, testName: string): TestDef["testKind"] | undefined {
  const entry = store.defs.find((e) => e.def.kind === "TestDef" && e.name === testName);
  return entry ? (entry.def as TestDef).testKind : undefined;
}

function scopeOfTest(
  store: Store,
  testName: string,
): { target: [number, number]; deps: Array<[number, number]> } | null {
  const testEntry = store.defs.find((e) => e.def.kind === "TestDef" && e.name === testName);
  if (!testEntry) return null;
  const td = testEntry.def as TestDef;
  if (!td.target) return null;
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
  if (store && typeof actual !== "string" && testKindOf(store, r.name) === "tile-test") {
    return bail("tile-leaf-not-text");
  }

  // ----- Planner 1: exact-literal repair (string / number / boolean) -----

  const exact = planExactLiteralPatchExplained(source, r, actual, expected, at, inExcluded, scope);
  if (exact.patch) return { patch: exact.patch };
  const exactReason = exact.reason;

  // ----- Planner 2: string prefix/suffix partial repair -----

  let partialReason: string | null = null;
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
    partialReason = partial.reason;
  }

  // ----- Planner 3: numeric slot delta → reducer arithmetic pattern -----

  let arithReason: string | null = null;
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
    arithReason = arith.reason;
  }

  const reason = arithReason ?? partialReason ?? exactReason;
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

function leafLit(v: unknown): string | null {
  if (typeof v === "string") return kumikiStringLit(v);
  if (typeof v === "number") return kumikiNumberLit(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

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

function tokenBounds(source: string): { starts: Set<number>; ends: Set<number> } | null {
  let tokens: ReturnType<typeof lex>;
  try {
    tokens = lex(source);
  } catch (e) {
    if (e instanceof LexError) return null;
    throw e;
  }
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const t of tokens) {
    if (t.kind === "eof") continue;
    const start = (lineStarts[t.pos.line - 1] ?? 0) + t.pos.col - 1;
    starts.add(start);
    ends.add(start + tokenLength(source, t, start));
  }
  return { starts, ends };
}

/** The source length of one token: a string's is read back from its quotes. */
function tokenLength(source: string, t: Exclude<Token, { kind: "eof" }>, start: number): number {
  if (t.kind === "num") return t.raw.length;
  if (t.kind !== "str") return t.value.length;
  let i = start + 1;
  while (i < source.length && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
  return i + 1 - start;
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
  const bounds = tokenBounds(source);
  if (bounds === null) return { patch: null, reason: "source-does-not-lex" };
  const notWholeToken = (offset: number): boolean =>
    inExcluded(offset) || !bounds.starts.has(offset) || !bounds.ends.has(offset + actualLit.length);
  const hit = pickScopedHit(source, actualLit, notWholeToken, scope);
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
  if (midA.length === 0 || midE.length === 0) return { patch: null, reason: "affix-empty-middle" };
  type Match = { start: number; end: number; body: string }; // body is DECODED
  const matches: Match[] = [];
  for (const lit of iterStringLiterals(source)) {
    if (inExcluded(lit.start)) continue;
    const decoded = decodeKumikiStringBody(lit.body);
    if (decoded === null) {
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
  const bodyIdx = target.body.indexOf(midA);
  if (bodyIdx < 0) return { patch: null, reason: "internal-body-not-found" };
  const patchedBody =
    target.body.slice(0, bodyIdx) + midE + target.body.slice(bodyIdx + midA.length);
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
  const reducers = reducersWritingSlot(store, slotName);
  if (reducers.length !== 1) return { patch: null, reason: "ambiguous-reducer-set" };
  const red = reducers[0]!;
  const stmtRe = new RegExp(
    `\\b${escapeRegex(slotName)}\\s*:=\\s*${escapeRegex(slotName)}\\s*([+\\-*])\\s*(-?\\d+)\\b`,
  );
  const bodyMatch = stmtRe.exec(red.body);
  if (!bodyMatch) return { patch: null, reason: "no-additive-multiplicative-shape" };
  const op = bodyMatch[1] as "+" | "-" | "*";
  const n = Number.parseInt(bodyMatch[2]!, 10);
  if (!Number.isSafeInteger(n)) return { patch: null, reason: "non-safe-integer-operand" };
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
      anchor: { kind: "region" },
    },
  };
}

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

export async function runFixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  // Compile tier: a file that doesn't compile can't run its tests — repair first.
  const store = load(path);
  const firstPass = check(store.program, { capabilities });
  const compileErrors = repairable(firstPass);
  let warnings = advisory(firstPass);
  const stamp = <T extends FixFromTestStatus>(o: T): T & { warnings: KumikiError[] } => ({
    ...o,
    warnings,
  });
  let compileFixes = 0;
  if (compileErrors.length > 0) {
    if (!apply) {
      const { patches, skipped } = planFixesExplained(store, compileErrors);
      if (patches.length === 0) return stamp(noCompilePatch(compileErrors, skipped));
      return stamp({
        ok: true,
        status: "compile-proposed",
        compileFixes: patches.length,
        compilePatches: patches,
      });
    }
    const result = applyFixPlan(path, undefined, capabilities);
    warnings = result.warnings;
    if (result.applied === 0) {
      if (result.writeError !== undefined) {
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
  const patched = patch.apply(curSource);
  const refused = await gateTestPatch(patched, testName, before, path, capabilities);
  if (refused !== null) {
    return stamp({
      ok: false,
      status: "test-blocked",
      patch,
      blocked: refused,
      ...(compileFixes ? { compileFixes } : {}),
    });
  }
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
  return stamp({
    ok: true,
    status: "applied",
    pass: true,
    patch,
    regressed: [],
    ...(compileFixes ? { compileFixes } : {}),
  });
}

async function gateTestPatch(
  patched: string,
  testName: string,
  before: readonly TestResult[],
  path: string,
  capabilities: string[],
): Promise<TestPatchBlock | null> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(lex(patched));
  } catch (e) {
    return { reason: "parse-error", message: e instanceof Error ? e.message : String(e) };
  }
  const introduced = repairable(check(parsed, { capabilities }));
  if (introduced.length > 0) return { reason: "introduced", introduced };
  let after: TestResult[];
  try {
    after = await runTestsSource(patched, capabilities, { sourcePath: path });
  } catch (e) {
    return { reason: "test-runner-threw", message: e instanceof Error ? e.message : String(e) };
  }
  const named = after.find((r) => r.name === testName);
  if (named === undefined) return { reason: "named-test-missing" };
  if (!named.pass) return { reason: "still-fails", failingTest: named };
  const regressed = before
    .filter((b) => b.pass && after.find((r) => r.name === b.name)?.pass !== true)
    .map((b) => b.name);
  if (regressed.length > 0) return { reason: "regressed", regressed };
  return null;
}

export async function fixFromTest(
  path: string,
  testName: string,
  apply: boolean,
  capabilities: string[] = [],
): Promise<FixFromTestOutcome> {
  const outcome = await runFixFromTest(path, testName, apply, capabilities);
  printFixFromTest(outcome, testName, path);
  reportWarnings(outcome.warnings);
  return outcome;
}

function printFixFromTest(outcome: FixFromTestOutcome, testName: string, path?: string): void {
  if (
    outcome.status !== "compile-blocked" &&
    outcome.compileFixes !== undefined &&
    outcome.compileFixes > 0 &&
    outcome.status !== "compile-remaining" &&
    outcome.status !== "compile-proposed" &&
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
      console.log(verdict(`applied fix — test "${testName}" now PASSES`, outcome.warnings));
      return;
    }
    case "test-blocked": {
      const kept = outcome.compileFixes
        ? "behavioural patch not written (compile fixes kept)"
        : "file left unchanged";
      console.log(`refused fix for "${testName}" — ${kept}:`);
      console.log(`  ${outcome.patch.description}`);
      console.log(`  reason: ${outcome.blocked.reason}`);
      const b = outcome.blocked;
      if (b.reason === "introduced")
        for (const e of b.introduced) console.error(`  ${e.code} ${e.message}`);
      else if (b.reason === "parse-error" || b.reason === "test-runner-threw")
        console.error(`  ${b.message}`);
      else if (b.reason === "regressed") console.log(`  would regress: ${b.regressed.join(", ")}`);
      else if (b.reason === "still-fails") {
        const t = b.failingTest;
        if (t.expected !== undefined) console.log(`  expected: ${t.expected}`);
        if (t.actual !== undefined) console.log(`  actual:   ${t.actual}`);
        if (t.diffAt !== undefined) console.log(`  diff at:  ${t.diffAt}`);
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
      const _exhaustive: never = outcome;
      throw new Error(`unhandled FixFromTestOutcome status: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
