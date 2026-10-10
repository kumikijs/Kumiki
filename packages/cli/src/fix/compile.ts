import { readFileSync } from "node:fs";
import type { AppDef, KumikiError, Pos } from "@kumikijs/compiler";
import {
  BUILTIN_EFFECT_CAPS,
  calleeCandidates,
  check,
  collectTimerNames,
  lex,
  nearestName,
  parse,
  servesNotFound,
  typeCandidates,
  variantTagsOf,
} from "@kumikijs/compiler";
import { listDefs, load, type Store } from "../store.ts";
import { messageOf } from "../text.ts";
import { atomicWriteFileSync } from "../write-lock.ts";
import { type AutoPatch, debugSkip, type PatchAnchor, type SkipReason } from "./patch.ts";
import {
  append404Route,
  appendAppCap,
  identifierAt,
  removeNamedArg,
  replaceAt,
  replaceOnLine,
} from "./text-edit.ts";

/** A planned repair without the diagnostic it answers, or the reason there is none. */
type Planned = Omit<AutoPatch, "code" | "message"> | string;

type Planner = (err: KumikiError, store: Store) => Planned;

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

function namesIn(store: Store, ...layers: string[]): string[] {
  return listDefs(store)
    .filter((e) => layers.length === 0 || layers.includes(e.layer))
    .map((e) => e.name);
}

type NameRepair = {
  /** Prefix of every skip reason this repair reports. */
  prefix: string;
  /** How many quoted names the message must carry; the misspelled one is the first. */
  quoted: 1 | 2;
  /** The names the misspelling may be close to; null when there are none to pick from. */
  pool: (store: Store, quoted: readonly string[]) => Iterable<string> | null;
  emptyPool?: string;
  noSuggestion: string;
  /** Write at the name when it sits at the diagnostic's position, else on its line. */
  anchored: boolean;
  /** The misspelled name, when it is not the first quoted one. */
  pick?: (quoted: readonly string[]) => string;
};

function nameRepair(r: NameRepair): Planner {
  return (err, store) => {
    const quoted = Array.from(err.message.matchAll(/"([^"]+)"/g), (m) => m[1]!);
    if (quoted.length < r.quoted) return `${r.prefix}quoted-name-extract-failed`;
    const missing = r.pick?.(quoted) ?? quoted[0]!;
    const pool = r.pool(store, quoted);
    if (pool === null) return `${r.prefix}${r.emptyPool}`;
    const suggested = nearestName(missing, pool);
    if (!suggested) return `${r.prefix}${r.noSuggestion}`;
    const anchor: PatchAnchor = r.anchored
      ? nameAnchor(store, err.pos, missing)
      : { kind: "span", pos: err.pos };
    return {
      description: `replace "${missing}" with "${suggested}" at ${err.pos.line}:${err.pos.col}`,
      apply: applyNameFix(anchor, missing, suggested),
      anchor,
    };
  };
}

const anyDefinition = nameRepair({
  prefix: "",
  quoted: 1,
  pool: (store) => namesIn(store),
  noSuggestion: "no-close-name-suggestion",
  anchored: true,
});

function variantTag(prefix: string, anchored: boolean): Planner {
  return nameRepair({
    prefix,
    quoted: 2,
    pool: (store, quoted) => {
      const tags = variantTagsOf(quoted[1]!, store.program);
      return tags && tags.length > 0 ? tags : null;
    },
    emptyPool: "unresolved-variant-type",
    noSuggestion: "no-close-tag",
    anchored,
  });
}

/**
 * A read outside the nested scope that declares the name, after it ended or before it begins, is
 * out of scope, not misspelled: the renamed read would type-check and read a different value.
 */
function outOfScopeReason(err: KumikiError): string | undefined {
  if (err.endedScope !== undefined) return "e0103-read-after-scope-ended";
  if (err.laterScope !== undefined) return "e0103-read-before-scope-begins";
  return undefined;
}

const PLANNERS: ReadonlyMap<string, Planner> = new Map<string, Planner>([
  ["E0102", anyDefinition], // undef-reducer
  [
    "E0103", // undef-ref / undef-slot
    (err, store) => outOfScopeReason(err) ?? anyDefinition(err, store),
  ],
  ["E0105", anyDefinition], // undef-tile
  ["E0107", anyDefinition], // undef-motion
  [
    "E0211", // undef-tile-in-selector
    nameRepair({
      prefix: "",
      quoted: 1,
      pick: (quoted) => quoted[quoted.length - 1]!,
      pool: (store) => namesIn(store),
      noSuggestion: "no-close-name-suggestion",
      anchored: true,
    }),
  ],
  [
    "E0106",
    nameRepair({
      prefix: "e0106-",
      quoted: 1,
      pool: (store) => {
        const timers = collectTimerNames(store.program);
        return timers.size > 0 ? timers : null;
      },
      emptyPool: "empty-timer-namespace",
      noSuggestion: "no-close-timer",
      anchored: true,
    }),
  ],
  [
    "E0116",
    nameRepair({
      prefix: "e0116-",
      quoted: 1,
      pool: (store, quoted) => calleeCandidates(namesIn(store, "fn"), quoted[0]!),
      noSuggestion: "no-close-callee",
      anchored: false,
    }),
  ],
  [
    "E0117",
    nameRepair({
      prefix: "e0117-",
      quoted: 1,
      pool: (store) => typeCandidates(namesIn(store, "type")),
      noSuggestion: "no-close-type",
      anchored: false,
    }),
  ],
  [
    "E0104",
    nameRepair({
      prefix: "e0104-",
      quoted: 1,
      pool: (store) => namesIn(store, "effect").concat([...BUILTIN_EFFECT_CAPS.keys()]),
      noSuggestion: "no-close-effect",
      anchored: false,
    }),
  ],
  [
    "E0118",
    nameRepair({
      prefix: "e0118-",
      quoted: 1,
      pool: (store) => namesIn(store, "theme", "slot"),
      noSuggestion: "no-close-theme",
      anchored: false,
    }),
  ],
  ["E0216", variantTag("e0216-", false)],
  ["E0209", variantTag("e0209-", true)],
  [
    "E0301",
    (err, store) => {
      const cap = /requires capability "([^"]+)"/.exec(err.message)?.[1];
      if (cap === undefined) return "e0301-quoted-name-extract-failed";
      if (!store.defs.some((e) => e.def.kind === "AppDef")) return "e0301-no-app-def";
      if (appendAppCap(store.source, cap) === null) {
        return "e0301-cap-already-present-or-no-caps-field";
      }
      return {
        description: `add capability "${cap}" to app.caps`,
        apply: (text) => appendAppCap(text, cap) ?? text,
        anchor: { kind: "region" },
      };
    },
  ],
  [
    "E0001",
    (_err, store) => {
      const app = store.program.defs.find((d): d is AppDef => d.kind === "AppDef");
      const routes = app?.routes ?? [];
      if (routes.some((r) => r.path === "/404") && !servesNotFound(routes)) {
        return "e0001-404-is-a-redirect";
      }
      if (append404Route(store.source) === null) return "e0001-no-routes-clause";
      const defined = store.byQName.has("tile.NotFound");
      return {
        description: defined
          ? `add "/404" -> NotFound to app.routes`
          : `add "/404" -> NotFound to app.routes, and define tile NotFound`,
        apply: (text) => {
          const routed = append404Route(text);
          if (routed === null) return text;
          return defined ? routed : `\ntile NotFound = page(heading("404"))\n${routed}`;
        },
        anchor: { kind: "region" },
      };
    },
  ],
  [
    "E0218",
    (err, store) => {
      const remedy = /iterate its (\.[a-z-]+)/.exec(err.message)?.[1];
      if (!remedy) return "e0218-remedy-extract-failed";
      const name = identifierAt(store, err.pos);
      if (!name) return "e0218-target-not-a-plain-name";
      return {
        description: `append "${remedy}" to "${name}" at ${err.pos.line}:${err.pos.col}`,
        apply: (text) => replaceAt(text, err.pos, name, `${name}${remedy}`),
        anchor: { kind: "span", pos: err.pos },
      };
    },
  ],
  [
    "E0119",
    (err) => ({
      description: `read the "route" slot instead of "$route" at ${err.pos.line}:${err.pos.col}`,
      apply: (text) => replaceAt(text, err.pos, "$route", "route"),
      anchor: { kind: "span", pos: err.pos },
    }),
  ],
  [
    "E0129",
    (err) => {
      if (err.unrendered === "text-prop") {
        return {
          description: `make the text= value the positional content at ${err.pos.line}:${err.pos.col}`,
          apply: (text) => replaceAt(text, err.pos, "text=", ""),
          anchor: { kind: "span", pos: err.pos },
        };
      }
      if (err.unrendered === "text-shadowed") {
        return {
          description: `remove the text= argument the positional one shadows at ${err.pos.line}:${err.pos.col}`,
          apply: (text) => removeNamedArg(text, err.pos, "text"),
          anchor: { kind: "span", pos: err.pos },
        };
      }
      return "e0129-dropped-argument-has-no-single-repair";
    },
  ],
  ["E0124", () => "e0124-type-arguments-unknown"],
]);

export function planFixesExplained(
  store: Store,
  errors: KumikiError[],
): { patches: AutoPatch[]; skipped: SkipReason[] } {
  const patches: AutoPatch[] = [];
  const skipped: SkipReason[] = [];
  for (const err of errors) {
    const planned = PLANNERS.get(err.code)?.(err, store) ?? "no-repair-branch";
    if (typeof planned === "string") {
      skipped.push({ code: err.code, reason: planned, message: err.message });
      debugSkip(`planFixes:${err.code}`, planned, err.message);
    } else {
      patches.push({ code: err.code, message: err.message, ...planned });
    }
  }
  return { patches, skipped };
}

export function planFixes(store: Store, errors: KumikiError[]): AutoPatch[] {
  return planFixesExplained(store, errors).patches;
}

const ANCHOR_TIER: Record<PatchAnchor["kind"], number> = { span: 0, line: 1, region: 2 };

/** Exact spans first, bottom-up so earlier offsets stay valid; then line and region patches. */
function applicationOrder(patches: AutoPatch[]): AutoPatch[] {
  return [...patches].sort((a, b) => {
    const tier = ANCHOR_TIER[a.anchor.kind] - ANCHOR_TIER[b.anchor.kind];
    if (tier !== 0) return tier;
    if (a.anchor.kind !== "span" || b.anchor.kind !== "span") return 0;
    return b.anchor.pos.line - a.anchor.pos.line || b.anchor.pos.col - a.anchor.pos.col;
  });
}

export function repairable(diagnostics: KumikiError[]): KumikiError[] {
  return diagnostics.filter((d) => d.severity !== "warning");
}

export function advisory(diagnostics: KumikiError[]): KumikiError[] {
  return diagnostics.filter((d) => d.severity === "warning");
}

export type FixPlan = {
  /** Typecheck errors on `path`, warnings excluded. Empty when the file is clean. */
  errors: KumikiError[];
  warnings: KumikiError[];
  /** Repairable subset, filtered by `onlyCode` when the caller passed it. */
  patches: AutoPatch[];
  skipped: SkipReason[];
};

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

function nothingWritten(
  plan: FixPlan,
  before: string,
  approved = 0,
): Omit<FixApplyResult, "remaining"> & { applied: 0 } {
  return {
    applied: 0,
    approved,
    before,
    after: before,
    warnings: plan.warnings,
    skipped: plan.skipped,
  };
}

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
      writeError: messageOf(e),
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

/** Accepts the composed patches only if they resolve something and introduce nothing. */
export function gateComposed(
  errors: KumikiError[],
  after: string,
  capabilities: string[] = [],
): GateVerdict {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(lex(after));
  } catch (e) {
    const message = messageOf(e);
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

function diagnosticKey(e: KumikiError): string {
  return JSON.stringify([e.code, e.kind, e.message]);
}

/** The diagnostics of `a` left over once each one in `b` cancels an equal one. */
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
