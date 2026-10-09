// Test harness slice of the stdlib (#71): reducer-test / property-test /
// tile-test runners and the §8.2.2 `expect` wildcards. Only `kumiki test` /
// smoke-tier code paths reach these, so they live apart from `stdlib.ts` —
// `kumiki build` output never ships them. `index.ts` merges this back into the
// classic `_stdlib` export for the inlining (full-bundle) path.

import {
  batchRejections,
  type EffectSpec,
  type EnvRead,
  emptyRoute,
  entryKey,
  type PanicCategory,
  type PanicCauseLink,
  panicInfo,
  type ReducerSpec,
  type RefinementNaming,
  type RefinementRejection,
  rejectedBatchText,
  reportRejectedBatch,
  withEnvReplay,
} from "./core.ts";
import { valueEqual } from "./stdlib.ts";

/**
 * Loose shapes for an inlined episode-log entry (spec/runtime.md §10.5.1)
 * sufficient for replay. Inlined by codegen at compile time, so the runtime
 * deals only with already-parsed objects — anything not matched falls back to
 * an unrecognized step that replay just skips over.
 */
type EpisodeReducerStep = {
  kind: "reducer";
  name: string;
  "slot-diffs"?: { name: string; before?: unknown; after: unknown }[];
  emits?: string[];
  /** What the body read from the environment (§10.5.1). Absent in older logs. */
  "env-reads"?: EnvRead[];
  ts?: number;
};
type EpisodeEffectEndStep = {
  kind: "effect-end";
  name: string;
  result: "ok" | "err";
  value: unknown;
  ts?: number;
};
type EpisodeStepLite =
  | EpisodeReducerStep
  | { kind: "effect-start"; name: string; args?: unknown; ts?: number }
  | EpisodeEffectEndStep
  | { kind: "signal-update"; "dirty-slots"?: string[]; "binds-updated"?: string[]; ts?: number }
  | {
      kind: "panic";
      message: string;
      location?: string;
      /** The reducer that threw, when the throw came from a reducer body. */
      name?: string;
      /** What that body read from the environment before it threw (§10.5.1). */
      "env-reads"?: EnvRead[];
      /** Root-cause devtools trail — optional so older logs still parse. */
      stack?: string;
      cause?: PanicCauseLink[];
      category?: PanicCategory;
      ts?: number;
    };

export type EpisodeLogEntry = {
  id: string;
  trigger: { kind: string; target?: string; payload?: unknown; ts?: number };
  steps: EpisodeStepLite[];
  status: "completed" | "panic" | "cancelled" | "ongoing";
};

/**
 * Mock resolution policy for an `episode-test` effect: replay the recorded
 * effect-end (`from-log`), drop the effect entirely (`ignore`), or inject a
 * fixed `{outcome, value}` deterministically.
 */
export type EpisodeMockPolicy =
  | { policy: "from-log" }
  | { policy: "ignore" }
  | { policy: "fixed"; outcome: "ok" | "err"; value: unknown };

export type TestResult = {
  name: string;
  pass: boolean;
  expected?: string;
  actual?: string;
  diffAt?: string;
  /**
   * The values at the divergence point (`diffAt`), when the runner can
   * isolate one — a scalar, or a list or record for a tile field such as
   * `options`. Powers the §8.7.1 value arrow (`expected -> actual`) and lets
   * `kumiki fix --auto-patch` find the responsible source literal.
   */
  leaf?: { expected: unknown; actual: unknown };
  /** Number of generated cases run by a `property-test` (for the §8.7.1 `(N cases)` tag). */
  cases?: number;
  /** Wall-clock milliseconds the test took (filled in by the runner, §8.7.1). */
  ms?: number;
};

function _jsonStr(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ----- reducer-test `expect` wildcards (spec/testing.md §8.2.2) -----
// `@@`-prefixed sentinels never collide with a Kumiki field name (identifiers
// are alphanumeric + hyphen, so `@` can never appear in one).
const WILD = "@@kumiki:wild";
/** A wildcard map key (`<any-id>` in key position): pairs with the one generated entry. */
const WILD_KEY = "@@kumiki:wild-key";
/** How many `<any-id>` members a Set literal has: each pairs with one generated member. */
const WILD_MEMBERS = "@@kumiki:wild-members";
/**
 * The `<slots.X>` keys of a Set or Map literal, as `[sentinel, value]` pairs
 * (a Set member's value is `true`): keyed only once the slots are known.
 */
const WILD_SLOT_KEYS = "@@kumiki:wild-slot-keys";

function isWildValue(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && Object.hasOwn(v, WILD);
}

/** The value a `<slots.X>` sentinel stands for: slot X after execution. */
function slotWildValue(w: Record<string, unknown>, finalSlots: Record<string, unknown>): unknown {
  return finalSlots[w.slot as string];
}

/**
 * Key each `<slots.X>` entry of an expected Set or Map by its slot's value,
 * the way `add` / `insert` key that value (`entryKey`), so it then matches as
 * if the value had been written in its place. Every member or key the literal
 * writes asks for one of its own, so a slot whose key is already among the
 * others answers `undefined`: the literal names more members than any Set or
 * Map can hold under those keys, and the match fails.
 *
 * Keys are defined as own properties, never assigned: assigning `__proto__`
 * would set the prototype instead of adding the key.
 */
function keySlotEntries(
  eo: Record<string, unknown>,
  finalSlots: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!Object.hasOwn(eo, WILD_SLOT_KEYS)) return eo;
  const keyed: Record<string, unknown> = {};
  const put = (k: string, v: unknown): void => {
    Object.defineProperty(keyed, k, { value: v, enumerable: true });
  };
  for (const k of Object.keys(eo)) if (k !== WILD_SLOT_KEYS) put(k, eo[k]);
  for (const [w, v] of eo[WILD_SLOT_KEYS] as [Record<string, unknown>, unknown][]) {
    const k = entryKey(slotWildValue(w, finalSlots));
    if (Object.hasOwn(keyed, k)) return undefined;
    put(k, v);
  }
  return keyed;
}

/**
 * Wildcard-aware structural match for reducer-test `expect` (§8.2.2). Records are
 * matched by exact key set; `<any-id>` (value) matches any present value, a
 * `<any-id>` map key pairs with exactly one otherwise-unmatched entry (0 or >1 →
 * fail), each `<any-id>` member of a Set literal pairs with one otherwise-unmatched
 * member (the counts must agree), and `<slots.X>` stands for slot X's post-execution value — as a
 * value, a Set member or a map key alike (as a member or key, one distinct from every other the
 * literal writes; `<any-id>` pairs only with what they leave). Falls back to deep equality when no wildcard is involved.
 */
function wildcardEqual(
  expected: unknown,
  actual: unknown,
  finalSlots: Record<string, unknown>,
): boolean {
  if (isWildValue(expected)) {
    const kind = expected[WILD];
    if (kind === "any-id") return actual !== undefined;
    if (kind === "slot") return valueEqual(actual, slotWildValue(expected, finalSlots));
    return false;
  }
  if (expected === actual) return true;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return false;
  }
  const eArr = Array.isArray(expected);
  const aArr = Array.isArray(actual);
  if (eArr || aArr) {
    if (!eArr || !aArr || expected.length !== actual.length) return false;
    return expected.every((x, i) => wildcardEqual(x, (actual as unknown[])[i], finalSlots));
  }
  const eo = keySlotEntries(expected as Record<string, unknown>, finalSlots);
  if (eo === undefined) return false;
  const ao = actual as Record<string, unknown>;
  const literalKeys = Object.keys(eo).filter((k) => k !== WILD_KEY && k !== WILD_MEMBERS);
  for (const k of literalKeys) {
    if (!Object.hasOwn(ao, k) || !wildcardEqual(eo[k], ao[k], finalSlots)) return false;
  }
  const leftover = Object.keys(ao).filter((k) => !literalKeys.includes(k));
  if (Object.hasOwn(eo, WILD_MEMBERS)) {
    return leftover.length === eo[WILD_MEMBERS] && leftover.every((k) => ao[k] === true);
  }
  if (Object.hasOwn(eo, WILD_KEY)) {
    if (leftover.length !== 1) return false;
    return wildcardEqual(eo[WILD_KEY], ao[leftover[0] as string], finalSlots);
  }
  return leftover.length === 0;
}

function tileField(node: unknown, k: string): unknown {
  return (node as Record<string, unknown> | null | undefined)?.[k];
}

function tileChildren(node: unknown): unknown[] {
  const c = tileField(node, "children");
  return Array.isArray(c) ? c.filter((x) => x != null) : [];
}

/**
 * Top-level fields of a tile node that are not content: `kind` (compared
 * first), `children` (recursed into), `props` (read below), and the identity
 * and wiring a node carries beside its content — `key` (the reconciler's
 * identity, stamped by `_wk`), `bind` / `bindPath` / `parse` (form
 * write-back) and `prefetch` / `prefetchArgs` (a link's §3.8 prefetch).
 */
const TILE_NOT_CONTENT: ReadonlySet<string> = new Set([
  "kind",
  "children",
  "props",
  "key",
  "bind",
  "bindPath",
  "parse",
  "prefetch",
  "prefetchArgs",
]);

/**
 * Entries of a node's `props` that are not content: `el` (the same arguments
 * again, as the element's attribute bag), `_tile` (the user-tile marker
 * `_named` adds) and the classes and styles spec §8.4 leaves out.
 */
const TILE_PROPS_NOT_CONTENT: ReadonlySet<string> = new Set(["el", "_tile", "class", "style"]);

/**
 * The content of a tile node, by name, in comparison order (spec §8.4).
 *
 * First the fields its builtin lifts to the top level — `text`, `src`, `to`,
 * `value`, `options`, … — then the named arguments codegen folds into `props`
 * (`alt`, `disabled`, `id`, …). Codegen folds a lifted argument into `props`
 * as well, so a name the top level already has is read there, once — and so
 * is a props key whose kebab argument the builtin lifted under its camelCase
 * name (`auto-focus` is `autoFocus` above and `auto_focus` here).
 *
 * Two fields are named the way the source writes them rather than the way
 * the node stores them, so that a path and a report line read like the
 * test: a toggle's `checked` state is its `value` argument, and the `aria`
 * map codegen merges every `aria-*` argument into is one entry per
 * attribute, named the attribute `commonAttrDecls` (core.ts) renders — so
 * stating one attribute asserts that one alone.
 *
 * Handlers are functions and are left out with everything listed above. A
 * tile-test's expected node never carries its `{…}` block in `props` — the
 * compiler leaves it out of the lowering (`GenCtx.expectedTree`) — so what
 * is left there is what the expectation was written with.
 */
function tileContent(node: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (node === null || typeof node !== "object") return out;
  const isContent = (v: unknown): boolean => v !== undefined && typeof v !== "function";
  for (const [k, v] of Object.entries(node)) {
    if (!TILE_NOT_CONTENT.has(k) && isContent(v)) out.set(k === "checked" ? "value" : k, v);
  }
  const props = tileField(node, "props");
  if (props === null || typeof props !== "object") return out;
  for (const [k, v] of Object.entries(props)) {
    if (TILE_PROPS_NOT_CONTENT.has(k) || !isContent(v)) continue;
    if (out.has(k) || out.has(k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()))) continue;
    if (k === "aria" && v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const [attr, a] of Object.entries(v)) {
        if (a != null) out.set(attr.startsWith("aria-") ? attr : `aria-${attr}`, a);
      }
      continue;
    }
    out.set(k, v);
  }
  return out;
}

/** A content value as compared: `text` went through `show` on both sides. */
function contentValue(k: string, v: unknown): unknown {
  return k === "text" && v !== undefined ? String(v) : v;
}

/**
 * Structural tile comparison for tile-tests (spec §8.4): compares `kind`,
 * every content field the EXPECTED node carries ({@link tileContent}), and
 * `children` recursively. A field only the actual node carries was not
 * asserted, so it is not compared. Returns the first differing path on
 * mismatch, with the two values there.
 */
function tileStructEqual(
  expected: unknown,
  actual: unknown,
  path = "",
): { ok: boolean; path?: string; expectedLeaf?: unknown; actualLeaf?: unknown } {
  if (expected == null || actual == null) {
    return expected === actual ? { ok: true } : { ok: false, path: path || "(root)" };
  }
  const ek = tileField(expected, "kind");
  const here = path || String(ek ?? "(root)");
  if (ek !== tileField(actual, "kind")) return { ok: false, path: `${here}.kind` };
  const got = tileContent(actual);
  for (const [k, raw] of tileContent(expected)) {
    const ev = contentValue(k, raw);
    const av = contentValue(k, got.get(k));
    if (!valueEqual(ev, av)) {
      // Carry the leaf values so the runner can print the §8.7.1 value arrow;
      // `kumiki fix --auto-patch` repairs a text leaf from them.
      return { ok: false, path: `${here}.${k}`, expectedLeaf: ev, actualLeaf: av };
    }
  }
  const ec = tileChildren(expected);
  const ac = tileChildren(actual);
  if (ec.length !== ac.length) return { ok: false, path: `${here}.children.length` };
  for (let i = 0; i < ec.length; i++) {
    const r = tileStructEqual(ec[i], ac[i], `${here}[${i}]`);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * One line per tile tree for the `expected:` / `actual:` report. `shape` is
 * the expected node at the same position, and only the fields
 * {@link tileStructEqual} compares there are printed — the text positionally,
 * the rest as `name=value`, a field `node` lacks left out — then the
 * children, each against the expected child beside it. A child with no
 * expected counterpart prints its kind and text.
 */
function serializeTileNode(node: unknown, shape: unknown = node): string {
  if (node == null) return "null";
  const kind = String(tileField(node, "kind"));
  const have = tileContent(node);
  const names = shape === null ? ["text"] : [...tileContent(shape).keys()];
  const parts: string[] = [];
  for (const k of names) {
    const v = have.get(k);
    if (v === undefined) continue;
    parts.push(k === "text" ? _jsonStr(String(v)) : `${k}=${_jsonStr(v)}`);
  }
  const shapeKids = shape === null ? [] : tileChildren(shape);
  tileChildren(node).forEach((kid, i) => {
    parts.push(serializeTileNode(kid, shapeKids[i] ?? null));
  });
  return `${kind}(${parts.join(", ")})`;
}

type ReducerExpect =
  | { kind: "panic"; message: string }
  | {
      kind: "state";
      slots: Record<string, unknown>;
      effects: { effect: string; args: unknown[]; argsSpecified?: boolean }[];
    };

/**
 * Compare a reducer-test's final state (slots + emitted/residual effects, or a
 * panic) against `expect`. Shared by the single-apply `runReducerTest` and the
 * multi-step `runReducerTestFlow`. Honors §8.2.2 wildcards via `wildcardEqual`.
 */
function compareReducerExpect(
  name: string,
  finalSlots: Record<string, unknown>,
  emits: { effect: string; args: unknown[] }[],
  panic: string | null,
  expect: ReducerExpect,
  unhandledErr: string | null = null,
): TestResult {
  if (expect.kind === "panic") {
    const pass = panic !== null && String(panic).includes(expect.message);
    return {
      name,
      pass,
      expected: `panic: ${_jsonStr(expect.message)}`,
      actual: panic === null ? "(no panic)" : `panic: ${_jsonStr(panic)}`,
      ...(pass ? {} : { diffAt: "(panic)" }),
    };
  }
  if (panic !== null) {
    return {
      name,
      pass: false,
      expected: _jsonStr(expect.slots),
      actual: `panic: ${_jsonStr(panic)}`,
      diffAt: "(unexpected panic)",
    };
  }
  // M2 (§8.5): a mocked `err` that no `.err` reducer consumes is a dropped error
  // — a clear test failure rather than a silent pass.
  if (unhandledErr !== null) {
    return {
      name,
      pass: false,
      expected: _jsonStr(expect.slots),
      actual: `unhandled effect error: ${unhandledErr} (no .err reducer)`,
      diffAt: "(unhandled effect error)",
    };
  }
  let diffAt: string | undefined;
  let leaf: { expected: unknown; actual: unknown } | undefined;
  for (const k of Object.keys(expect.slots)) {
    // Wildcard-aware (§8.2.2): `expect` is the pattern, `finalSlots[k]` the value.
    if (!wildcardEqual(expect.slots[k], finalSlots[k], finalSlots)) {
      diffAt = `slots.${k}`;
      leaf = { expected: expect.slots[k], actual: finalSlots[k] };
      break;
    }
  }
  if (diffAt === undefined) {
    if (emits.length !== expect.effects.length) {
      diffAt = "effects.length";
    } else {
      for (let i = 0; i < expect.effects.length; i++) {
        const ex = expect.effects[i];
        const ac = emits[i];
        if (!ex || !ac || ex.effect !== ac.effect) {
          diffAt = `effects[${i}].effect`;
          break;
        }
        // A bare effect name (`persist`) matches by name only; `persist(...)`
        // (even `persist()`) pins the exact argument list. `<slots.X>` args
        // (§8.2.2) match the post-execution slot value.
        if (ex.argsSpecified && !wildcardEqual(ex.args, ac.args, finalSlots)) {
          diffAt = `effects[${i}].args`;
          break;
        }
      }
    }
  }
  const pickExpected = (s: Record<string, unknown>): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(expect.slots)) o[k] = s[k];
    return o;
  };
  return {
    name,
    pass: diffAt === undefined,
    expected: `slots=${_jsonStr(expect.slots)} effects=${_jsonStr(expect.effects.map((e) => e.effect))}`,
    actual: `slots=${_jsonStr(pickExpected(finalSlots))} effects=${_jsonStr(emits.map((e) => e.effect))}`,
    ...(diffAt ? { diffAt } : {}),
    ...(leaf ? { leaf } : {}),
  };
}

// ----- property-test generators / runner (spec/testing.md §8.3) -----

/** A type's generation recipe, emitted by codegen from the `for-all` types. */
export type GenDesc =
  | { t: "Int"; min?: number; max?: number; oneOf?: (number | string)[] }
  | { t: "Float"; min?: number; max?: number; oneOf?: (number | string)[] }
  | {
      t: "Text";
      minLen?: number;
      maxLen?: number;
      /** A refined shape to build an instance of, rather than free text. */
      form?: "email" | "url" | "uuid";
      oneOf?: (number | string)[];
    }
  | { t: "Bool" }
  | { t: "List"; elem: GenDesc }
  | { t: "Set"; elem: GenDesc }
  | { t: "Map"; key: GenDesc; val: GenDesc }
  | { t: "Option"; inner: GenDesc }
  | { t: "Result"; ok: GenDesc; err: GenDesc }
  | { t: "Record"; fields: { name: string; desc: GenDesc }[] }
  | { t: "Union"; variants: { name: string; payloads: GenDesc[] }[] }
  | { t: "Unknown" };

/** Deterministic PRNG (mulberry32) so a failing property reproduces exactly. */
function _rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const _GEN_ASCII = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";

/** A value of one of the shapes `email` / `url` / `uuid` refine to (#352). */
function genForm(form: "email" | "url" | "uuid", rng: () => number): string {
  const hex = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(rng() * 16)];
    return s;
  };
  const word = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyz"[Math.floor(rng() * 26)];
    return s;
  };
  if (form === "uuid") return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  if (form === "email") return `${word(6)}@${word(6)}.example.com`;
  return `https://${word(6)}.example.com/${word(4)}`;
}

/**
 * The shape {@link genForm} builds each form in: its literal text, with a run
 * of letters (or hex digits) wherever it draws a word. Every value in it passes
 * the runtime's own check for the form — `packages/tests` holds the two to each
 * other over what generation and shrinking produce — and a shrunk form stays in
 * it, so a counterexample reads like the value it was shrunk from.
 */
const FORM_SHAPES: Record<"email" | "url" | "uuid", RegExp> = {
  email: /^[a-z]+@[a-z]+\.example\.com$/,
  url: /^https:\/\/[a-z]+\.example\.com\/[a-z]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

/**
 * The literals a `one-of` descriptor lists, or `undefined` when it lists none.
 * They name the whole domain, whatever base type they refine, so generation,
 * admission and shrinking all answer them ahead of the type.
 */
function choicesOf(desc: GenDesc): (number | string)[] | undefined {
  return "oneOf" in desc && desc.oneOf && desc.oneOf.length > 0 ? desc.oneOf : undefined;
}

/** A descriptor whose values shrinking proposes directly, rather than out of parts. */
type ScalarDesc = Extract<GenDesc, { t: "Int" | "Float" | "Text" }>;

/**
 * Whether `v` is in the domain `desc` declares — the constraints its
 * refinements folded into it, read from the same fields {@link genValue}
 * builds a value to: one of its `one-of` literals; an `Int` or `Float` within
 * `min` / `max` (an `Int` whole); a `Text` within `minLen` / `maxLen` and, for
 * a form, in the shape that form is generated in. The spans an unbounded type
 * is sampled from (±1000, 50 characters) are where generation looks, not part
 * of the domain.
 *
 * Every number and text {@link _shrink} proposes passes it, so a shrunk
 * counterexample is one the `for-all` could have generated.
 */
function admits(desc: ScalarDesc, v: unknown): boolean {
  const choices = choicesOf(desc);
  if (choices) return choices.includes(v as number | string);
  if (desc.t === "Text") {
    return (
      typeof v === "string" &&
      v.length >= (desc.minLen ?? 0) &&
      v.length <= (desc.maxLen ?? Number.POSITIVE_INFINITY) &&
      (desc.form === undefined || FORM_SHAPES[desc.form].test(v))
    );
  }
  return (
    typeof v === "number" &&
    (desc.t === "Float" || Number.isInteger(v)) &&
    v >= (desc.min ?? Number.NEGATIVE_INFINITY) &&
    v <= (desc.max ?? Number.POSITIVE_INFINITY)
  );
}

function genValue(desc: GenDesc, rng: () => number): unknown {
  const choices = choicesOf(desc);
  if (choices) return choices[Math.floor(rng() * choices.length)];
  switch (desc.t) {
    case "Int": {
      const lo = desc.min ?? -1000;
      const hi = desc.max ?? 1000;
      return lo + Math.floor(rng() * (hi - lo + 1));
    }
    case "Float": {
      const lo = desc.min ?? -1000;
      const hi = desc.max ?? 1000;
      return lo + rng() * (hi - lo);
    }
    case "Text": {
      if (desc.form) return genForm(desc.form, rng);
      const minLen = desc.minLen ?? 0;
      const maxLen = desc.maxLen ?? 50;
      const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
      let s = "";
      for (let i = 0; i < len; i++) s += _GEN_ASCII[Math.floor(rng() * _GEN_ASCII.length)];
      return s;
    }
    case "Bool":
      return rng() < 0.5;
    case "List": {
      const n = Math.floor(rng() * 11);
      const a: unknown[] = [];
      for (let i = 0; i < n; i++) a.push(genValue(desc.elem, rng));
      return a;
    }
    case "Set": {
      const n = Math.floor(rng() * 11);
      const o: Record<string, true> = {};
      for (let i = 0; i < n; i++) o[String(genValue(desc.elem, rng))] = true;
      return o;
    }
    case "Map": {
      const n = Math.floor(rng() * 11);
      const o: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) o[String(genValue(desc.key, rng))] = genValue(desc.val, rng);
      return o;
    }
    case "Option":
      return rng() < 0.5 ? { _tag: "None" } : { _tag: "Some", _0: genValue(desc.inner, rng) };
    case "Result":
      return rng() < 0.5
        ? { _tag: "Ok", _0: genValue(desc.ok, rng) }
        : { _tag: "Err", _0: genValue(desc.err, rng) };
    case "Record": {
      const o: Record<string, unknown> = {};
      for (const f of desc.fields) o[f.name] = genValue(f.desc, rng);
      return o;
    }
    case "Union": {
      const v = desc.variants[Math.floor(rng() * desc.variants.length)];
      if (!v) return null;
      const node: Record<string, unknown> = { _tag: v.name };
      v.payloads.forEach((p, i) => {
        node[`_${i}`] = genValue(p, rng);
      });
      return node;
    }
    default:
      return null;
  }
}

/**
 * Values of `desc` "simpler" than `v`, for shrinking a counterexample, simplest
 * first — each one inside the domain `desc` declares, so the counterexample
 * shrinking settles on is a value the generator could have produced.
 *
 * - A `one-of` value: the literals listed before it, the first one first.
 * - A number: the value nearest zero the bounds allow (zero itself when they
 *   hold it), and the point halfway there.
 * - A text: its prefix of the shortest length allowed and its prefix of half
 *   its length; a form's text also each text one character shorter, which is
 *   how it shortens a word and keeps its literal parts.
 * - A list, a set or a map: no elements, and each one element fewer.
 * - `Some`: `None`.
 * - A record: each field's own candidates, one field at a time.
 *
 * A number's and a text's candidates are the ones {@link admits} passes; a
 * structure's are made of those, or of the parts it was generated with. A
 * `Bool`, a `Result` and a union variant are left as generated.
 */
function _shrink(desc: GenDesc, v: unknown): unknown[] {
  const choices = choicesOf(desc);
  if (choices) {
    const at = choices.indexOf(v as number | string);
    return at > 0 ? choices.slice(0, at) : [];
  }
  switch (desc.t) {
    case "Int":
    case "Float": {
      if (typeof v !== "number") return [];
      const target = Math.min(
        Math.max(0, desc.min ?? Number.NEGATIVE_INFINITY),
        desc.max ?? Number.POSITIVE_INFINITY,
      );
      if (v === target) return [];
      const half = target + Math.trunc((v - target) / 2);
      return (half === target ? [target] : [target, half]).filter((c) => admits(desc, c));
    }
    case "Text": {
      if (typeof v !== "string") return [];
      const out = new Set([
        v.slice(0, desc.minLen ?? 0),
        v.slice(0, Math.max(desc.minLen ?? 0, Math.floor(v.length / 2))),
      ]);
      if (desc.form) for (let i = 0; i < v.length; i++) out.add(v.slice(0, i) + v.slice(i + 1));
      out.delete(v);
      return [...out].filter((c) => admits(desc, c));
    }
    case "List":
      if (!Array.isArray(v) || v.length === 0) return [];
      return [[], ...v.map((_, i) => [...v.slice(0, i), ...v.slice(i + 1)])];
    case "Set":
    case "Map": {
      const keys = v && typeof v === "object" ? Object.keys(v) : [];
      if (keys.length === 0) return [];
      return [
        {},
        ...keys.map((k) =>
          Object.fromEntries(Object.entries(v as object).filter(([j]) => j !== k)),
        ),
      ];
    }
    case "Option":
      return (v as { _tag?: unknown } | null)?._tag === "Some" ? [{ _tag: "None" }] : [];
    case "Record": {
      if (!v || typeof v !== "object") return [];
      const o = v as Record<string, unknown>;
      return desc.fields.flatMap((f) =>
        _shrink(f.desc, o[f.name]).map((c) => ({ ...o, [f.name]: c })),
      );
    }
    default:
      return [];
  }
}

/**
 * Greedily minimize a failing binding set, each var by its own descriptor:
 * a candidate is taken when `fails` still holds for it.
 */
function shrinkCounterexample(
  vars: Record<string, GenDesc>,
  fails: (b: Record<string, unknown>) => boolean,
  binds: Record<string, unknown>,
): Record<string, unknown> {
  let cur = { ...binds };
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 1000) {
    improved = false;
    for (const [k, desc] of Object.entries(vars)) {
      for (const cand of _shrink(desc, cur[k])) {
        const next = { ...cur, [k]: cand };
        if (fails(next)) {
          cur = next;
          improved = true;
          break;
        }
      }
    }
  }
  return cur;
}

/** A `run-reducer` step whose batch a refinement refused (runtime.md §10.3.3). */
type RefusedStep = { reducer: string; rejected: RefinementRejection[] };

/**
 * The refused steps of the property-test trial running now, or `undefined`
 * outside one. `runReducerStep` adds to it and `runPropertyTest` reads it: the
 * step is called from inside the generated trial, which answers only whether
 * its invariant held.
 */
let trialRefusals: RefusedStep[] | undefined;

// ----- shared per-episode executor (spec/testing.md §8.6 + runtime.md §10.5.3) -----
// Drives the reducer queue, applies effect mocks, and emits observer events.
// Both `runEpisodeTest` (assert) and `replayEpisodes` (trace) call this — a
// single implementation keeps `from-log` cursor / refine ward / unhandled-err
// accounting from drifting between the test runner and the CLI replay verb.

/**
 * The slot descriptor every harness in this file reads: the value, its
 * refinement, and the fields that say which predicate refused a write. The
 * naming fields are load-bearing rather than decorative — `batchRejections`
 * resolves the failed predicate from `refineAll` (core.ts), so a shape that
 * left them out would have this tier name a different predicate than the live
 * mount for the same rejected value — and `refineFailure` among them is, for
 * a type with a predicate written inside it, the gate itself (`slotAccepts`).
 */
type SlotMetaLike = { value: unknown; refine?: (v: unknown) => boolean } & RefinementNaming;

/**
 * The minimum app shape `executeEpisode` / `replayEpisodes` / `runEpisodeTest`
 * consume, and the reducer-test runner too. `effects` is required, not optional: it is where a
 * mocked or replayed err is read ({@link standInValue}), and a caller that
 * left it out would deliver every such err as written.
 */
export type ReplayApp = {
  live: Record<string, unknown>;
  slots: Record<string, SlotMetaLike>;
  reducers: ReducerSpec[];
  effects: Record<string, Pick<EffectSpec, "errText">>;
};

/**
 * The value `.ok` / `.err` receives from a result that stands in for `eff`'s
 * invoke instead of running it — a scenario script, a `reducer-test` /
 * `episode-test` mock, a `kumiki replay --mock`, a replayed effect-end
 * (stdlib.md §2.5, testing.md §8.5). An err on an effect that fails with
 * `Text` is read through the spec's own `errText`, as the invoke reads a
 * provider's err. A missing err value there is a provider's err with no
 * `value`, not `null`: `errText(undefined)` is the `Text` `"undefined"`. Any
 * other value — an ok, an `HttpError`, a custom capability's `E` — is
 * delivered as written, with a missing one as `null`. `eff` is undefined for a
 * name the app declares no effect for.
 */
export function standInValue(
  eff: Pick<EffectSpec, "errText"> | undefined,
  outcome: "ok" | "err",
  value: unknown,
): unknown {
  return outcome === "err" && eff?.errText ? eff.errText(value) : (value ?? null);
}

/**
 * Observer event for a single replay step (spec/runtime.md §10.5.1 step kinds,
 * plus the `episode-start` / `episode-end` brackets the executor adds so the
 * formatter can frame each episode). Step indices are 1-based and increment
 * across episodes — the `--until-step N` flag stops the executor after the Nth
 * such event fires.
 */
export type ReplayEvent =
  | {
      kind: "episode-start";
      episodeId: string;
      trigger: { kind: string; target?: string; payload?: unknown };
      /**
       * The entry reducer, when it is an `.ok` / `.err` reducer whose value
       * the log does not carry (§10.5.3): it runs with no `$1`.
       */
      entryResultMissing?: string;
    }
  | {
      kind: "reducer";
      episodeId: string;
      stepIndex: number;
      name: string;
      slotDiffs: { name: string; before: unknown; after: unknown }[];
      /**
       * Where this body's environment reads came from. Omitted when the log
       * answered every one of them and the body asked for every one it
       * carried — the case a reader does not need told about.
       */
      env?: EnvDrift;
    }
  | {
      kind: "effect-start";
      episodeId: string;
      stepIndex: number;
      name: string;
      args: unknown;
    }
  | {
      kind: "effect-end";
      episodeId: string;
      stepIndex: number;
      name: string;
      outcome: "ok" | "err" | null;
      value: unknown;
      source: "from-log" | "fixed" | "ignored";
    }
  | { kind: "signal-update"; episodeId: string; stepIndex: number; dirty: string[] }
  | {
      kind: "panic";
      episodeId: string;
      stepIndex: number;
      message: string;
      /** Propagate root-cause fields so the replay CLI can render them. */
      location?: string;
      stack?: string;
      cause?: PanicCauseLink[];
      category?: PanicCategory;
    }
  | { kind: "episode-end"; episodeId: string };

/**
 * Returns `"stop"` to halt the executor immediately after this event (the event
 * itself still landed — the caller has already seen the corresponding step run).
 * Used by `--until-step N` to short-circuit replay; the test runner passes a
 * `() => "continue"` no-op.
 */
export type ReplayObserver = (event: ReplayEvent) => "continue" | "stop";

/**
 * Environment-read provenance for a replay (§10.5.3). A read the log could not
 * answer was taken live, which is the one thing a replay cannot reproduce;
 * without a count there is no way, after the fact, to tell that apart from a
 * read that WAS answered from the log.
 */
export type EnvDrift = {
  /** Reads with no recorded answer left; the live source was used instead. */
  live: number;
  /** Recorded answers the replayed bodies never asked for. */
  unused: number;
  /** Entries in the log that were not well-formed reads, and were rejected. */
  malformed: number;
};

export type ReplayReport = {
  panics: {
    episodeId: string;
    message: string;
    /** Keep root-cause fields on the aggregate report too. Optional for back-compat with older callers. */
    location?: string;
    stack?: string;
    cause?: PanicCauseLink[];
    category?: PanicCategory;
  }[];
  /**
   * Effect emits whose `.err` outcome had no `.err` reducer to catch. Carries
   * the source `episodeId` so multi-episode replays can pinpoint which one
   * leaked — the symmetric shape to `panics` keeps consumers uniform.
   */
  unhandledErrors: { episodeId: string; effect: string }[];
  /** Step index at which `--until-step` interrupted the run, or `null` if all episodes finished. */
  stoppedAt: number | null;
  finalSlots: Record<string, unknown>;
  /** Environment-read provenance, summed over every replayed reducer body. */
  envDrift: EnvDrift;
  /** Episodes whose entry reducer's recorded result was not in the log (§10.5.3). */
  entryResultsMissing: { episodeId: string; reducer: string }[];
};

/**
 * Seed the router-maintained `route` slot (testing.md §8.2.5). Seeded only
 * when absent: no `.kumiki` can declare `route`, but a host-built slot table
 * can carry one, and that one wins.
 */
function seedRoute(live: Record<string, unknown>): void {
  if (!("route" in live)) live.route = emptyRoute();
}

/** Reset `app.live` to the slot defaults (hermetic start, §8.6). */
function resetLiveFromSlots(app: ReplayApp): void {
  for (const k of Object.keys(app.live)) delete app.live[k];
  for (const [k, m] of Object.entries(app.slots)) app.live[k] = m.value;
  seedRoute(app.live);
}

/**
 * The payload the episode's entry reducer ran with (§10.5.3).
 *
 * The live runtime records `trigger.payload` as the payload it handed the
 * reducer — `{$el, $event}` for a UI event, `{$1, $2}` for an effect result —
 * so it is passed on as it is. A trigger with no payload whose entry reducer
 * is an `.ok` / `.err` reducer (an `ssr.hydrate` bootstrap, which is opened
 * by the SSR pass rather than by a reducer) ran on the last `effect-end` of
 * that effect and outcome recorded before it, and that step's value, read
 * as any replayed result is ({@link standInValue}), is its `$1`. There is
 * deliberately no `$2`: the SSR pass itself passes
 * `$2: undefined`. Handing the value over consumes it, so the `from-log`
 * cursor of that effect starts past it. With no such step the log cannot
 * answer, and `undefined` says so for the caller to report.
 */
function entryPayload(
  effects: ReplayApp["effects"],
  ep: EpisodeLogEntry,
  entry: ReducerSpec,
  firstRed: EpisodeStepLite,
  cursors: Record<string, number>,
): Record<string, unknown> | undefined {
  const recorded = ep.trigger.payload;
  if (recorded !== null && typeof recorded === "object" && !Array.isArray(recorded)) {
    return recorded as Record<string, unknown>;
  }
  if (entry.event.kind !== "effect") return {};
  const { effect, outcome } = entry.event;
  let nth = -1;
  let value: unknown;
  let found = false;
  for (const s of ep.steps) {
    if (s === firstRed) break;
    if (s.kind !== "effect-end" || s.name !== effect) continue;
    nth++;
    if (s.result === outcome) {
      value = standInValue(effects[effect], outcome, s.value);
      found = true;
      cursors[effect] = nth + 1;
    }
  }
  return found ? { $1: value } : undefined;
}

function executeEpisode(
  app: ReplayApp,
  ep: EpisodeLogEntry,
  mocks: Record<string, EpisodeMockPolicy>,
  observer: ReplayObserver,
  stepCounter: { n: number },
  untilStep: number | undefined,
  // Accumulated across episodes by the caller, for the same reason
  // `stepCounter` is: every `return` below would otherwise have to carry it.
  envDrift: EnvDrift,
): {
  panics: {
    message: string;
    location?: string;
    stack?: string;
    cause?: PanicCauseLink[];
    category?: PanicCategory;
  }[];
  unhandledErrors: { effect: string }[];
  stopped: boolean;
} {
  const panics: {
    message: string;
    location?: string;
    stack?: string;
    cause?: PanicCauseLink[];
    category?: PanicCategory;
  }[] = [];
  const unhandledErrors: { effect: string }[] = [];

  // Apply a reducer's slot writes under the runtime.md §10.3.3 all-or-nothing
  // rule: if any slot's new value fails its refinement, nothing is written and
  // the caller drops that reducer's emits too. Returns null in that case, so a
  // rejected batch is distinguishable from one that legitimately changed
  // nothing. Replay must match the live runtime here — the whole point of the
  // tier is to reproduce what the app actually did.
  const writeSlots = (
    reducerName: string,
    res: { slots?: Record<string, unknown>; rejected?: RefinementRejection[] } | undefined,
  ): { name: string; before: unknown; after: unknown }[] | null => {
    const rejected = batchRejections(res, app.slots);
    if (rejected.length > 0) {
      reportRejectedBatch(reducerName, rejected);
      return null;
    }
    const diffs: { name: string; before: unknown; after: unknown }[] = [];
    for (const [k, v] of Object.entries(res?.slots ?? {})) {
      const before = app.live[k];
      app.live[k] = v;
      if (!valueEqual(before, v)) diffs.push({ name: k, before, after: v });
    }
    return diffs;
  };

  // Stop signal is shared with the caller (untilStep) AND the observer return.
  const emit = (ev: ReplayEvent): boolean => {
    // `episode-start` / `episode-end` are bracket markers — not counted as
    // steps so `--until-step N` lines up with the printable trace lines.
    if (ev.kind !== "episode-start" && ev.kind !== "episode-end") {
      stepCounter.n += 1;
      (ev as { stepIndex: number }).stepIndex = stepCounter.n;
    }
    const verdict = observer(ev);
    if (verdict === "stop") return true;
    if (
      ev.kind !== "episode-start" &&
      ev.kind !== "episode-end" &&
      untilStep !== undefined &&
      stepCounter.n >= untilStep
    ) {
      return true;
    }
    return false;
  };

  // The episode's entry reducer. A reducer whose body threw wrote NO `reducer`
  // step — only a `panic` one — so an episode that crashed on its first
  // reducer would otherwise replay as an episode with nothing in it, and
  // `kumiki replay` would exit 0 on a recorded crash. The panic step carries
  // the reducer's name for exactly this.
  const firstRed = ep.steps.find(
    (s): s is EpisodeReducerStep | (EpisodeStepLite & { kind: "panic"; name: string }) =>
      s.kind === "reducer" || (s.kind === "panic" && typeof s.name === "string"),
  );
  const entry = firstRed && app.reducers.find((r) => r.name === firstRed.name);
  const cursors: Record<string, number> = {};
  const entryIn = firstRed && entry ? entryPayload(app.effects, ep, entry, firstRed, cursors) : {};
  // Reported rather than inferred (§10.5.3): a trimmed or hand-edited log that
  // lost the value would otherwise read as a reducer that panics on its own.
  const entryResultMissing = entryIn === undefined ? entry?.name : undefined;
  const started: ReplayEvent = {
    kind: "episode-start",
    episodeId: ep.id,
    trigger: ep.trigger,
    ...(entryResultMissing !== undefined ? { entryResultMissing } : {}),
  };
  if (emit(started)) return { panics, unhandledErrors, stopped: true };
  if (!firstRed || !entry) {
    emit({ kind: "episode-end", episodeId: ep.id });
    return { panics, unhandledErrors, stopped: false };
  }

  // Per-effect FIFO of recorded effect-end values for `from-log` mocks.
  const recordedResults: Record<string, { result: "ok" | "err"; value: unknown }[]> = {};
  // Per-reducer FIFO of recorded environment reads (§10.5.1). Replay derives
  // the chain by re-executing reducers rather than walking the log's steps, so
  // there is no step to read the reads off — they are keyed by reducer NAME,
  // and the nth run of reducer `foo` takes the nth recorded `foo`.
  //
  // That is an ordering assumption, not an alignment guarantee. Replay walks
  // `res.emits` in declaration order while the recording appended `.ok` / `.err`
  // steps in effect-COMPLETION order, so a reducer reached twice by two
  // effects that completed out of declaration order gets the two recorded read
  // sets swapped. The failure is silent — crossed-over values, not a fallback
  // — which is why the `live` count below cannot detect it and §10.5.3 names
  // the case.
  //
  // A `panic` step is harvested on the same key: it carries the reducer's name
  // for exactly this, so the episode that crashed replays the reads that
  // crashed it.
  const recordedEnvReads: Record<string, EnvRead[][]> = {};
  const harvestEnvReads = (name: string | undefined, reads: EnvRead[] | undefined): void => {
    if (name === undefined) return;
    const list = recordedEnvReads[name] ?? [];
    list.push(reads ?? []);
    recordedEnvReads[name] = list;
  };
  for (const s of ep.steps) {
    if (s.kind === "effect-end") {
      const list = recordedResults[s.name] ?? [];
      list.push({ result: s.result, value: s.value });
      recordedResults[s.name] = list;
    }
    if (s.kind === "reducer" || s.kind === "panic") harvestEnvReads(s.name, s["env-reads"]);
  }
  const envCursors: Record<string, number> = {};

  /**
   * Hand the reducer the environment it read when the episode was recorded.
   * With nothing recorded for it — an older log, or a reducer the chain
   * reached that the recording never logged — the scope is empty and every
   * read falls through to the live source, which is the pre-#337 behaviour.
   */
  const takeEnvReads = (reducerName: string): EnvRead[] => {
    const list = recordedEnvReads[reducerName] ?? [];
    const idx = envCursors[reducerName] ?? 0;
    envCursors[reducerName] = idx + 1;
    return list[idx] ?? [];
  };

  const queue: { reducer: ReducerSpec; payload: Record<string, unknown> }[] = [
    { reducer: entry, payload: entryIn ?? {} },
  ];

  let guard = 0;
  const dirtyForEpisode = new Set<string>();

  while (queue.length > 0 && guard++ < 10000) {
    const job = queue.shift();
    if (!job) break;
    const outcome = withEnvReplay(takeEnvReads(job.reducer.name), () =>
      job.reducer.apply(app.live, job.payload),
    );
    const stepEnv: EnvDrift = {
      live: outcome.env.live,
      unused: outcome.env.unused,
      malformed: outcome.env.malformed,
    };
    envDrift.live += stepEnv.live;
    envDrift.unused += stepEnv.unused;
    envDrift.malformed += stepEnv.malformed;
    const envClean = stepEnv.live === 0 && stepEnv.unused === 0 && stepEnv.malformed === 0;
    if (!outcome.ok) {
      const e = outcome.error;
      // Derive the record via panicInfo so stack + Error.cause reach the
      // replay CLI unchanged. The runner treats this catch site as `reducer`
      // — it's replaying the initial reducer of a recorded episode. If the
      // thrown KumikiPanic didn't stamp its own location, fall back to the
      // reducer name we're replaying so the CLI can render "reducer "foo""
      // instead of leaving the location blank.
      const rec = panicInfo(e, "reducer");
      const location = rec.location ?? `reducer "${job.reducer.name}"`;
      const panicEntry: {
        message: string;
        location?: string;
        stack?: string;
        cause?: PanicCauseLink[];
        category?: PanicCategory;
      } = { message: rec.message, location, category: rec.category };
      if (rec.stack !== undefined) panicEntry.stack = rec.stack;
      if (rec.cause !== undefined) panicEntry.cause = rec.cause;
      panics.push(panicEntry);
      if (
        emit({
          kind: "panic",
          episodeId: ep.id,
          stepIndex: 0,
          message: rec.message,
          location,
          ...(rec.stack !== undefined ? { stack: rec.stack } : {}),
          ...(rec.cause !== undefined ? { cause: rec.cause } : {}),
          category: rec.category,
        })
      ) {
        return { panics, unhandledErrors, stopped: true };
      }
      continue;
    }
    const res = outcome.value;
    const written = writeSlots(job.reducer.name, res);
    const diffs = written ?? [];
    for (const d of diffs) dirtyForEpisode.add(d.name);
    if (
      emit({
        kind: "reducer",
        episodeId: ep.id,
        stepIndex: 0,
        name: job.reducer.name,
        slotDiffs: diffs,
        ...(envClean ? {} : { env: stepEnv }),
      })
    ) {
      return { panics, unhandledErrors, stopped: true };
    }
    // A rejected batch produced its emits from state that never became real,
    // so the effect chain below must not run (§10.3.3).
    if (written === null) continue;
    for (const eEmit of res.emits ?? []) {
      const mock = mocks[eEmit.effect];
      if (
        emit({
          kind: "effect-start",
          episodeId: ep.id,
          stepIndex: 0,
          name: eEmit.effect,
          args: eEmit.args ?? [],
        })
      ) {
        return { panics, unhandledErrors, stopped: true };
      }
      if (!mock || mock.policy === "ignore") {
        if (
          emit({
            kind: "effect-end",
            episodeId: ep.id,
            stepIndex: 0,
            name: eEmit.effect,
            outcome: null,
            value: null,
            source: "ignored",
          })
        ) {
          return { panics, unhandledErrors, stopped: true };
        }
        continue;
      }
      let outcome: "ok" | "err";
      let value: unknown;
      let source: "from-log" | "fixed";
      if (mock.policy === "from-log") {
        const list = recordedResults[eEmit.effect] ?? [];
        const idx = cursors[eEmit.effect] ?? 0;
        const recorded = list[idx];
        if (!recorded) {
          // Recorded log doesn't have an effect-end for this slot — drop the
          // emit (testkit behaviour) but still surface a trace marker.
          if (
            emit({
              kind: "effect-end",
              episodeId: ep.id,
              stepIndex: 0,
              name: eEmit.effect,
              outcome: null,
              value: null,
              source: "ignored",
            })
          ) {
            return { panics, unhandledErrors, stopped: true };
          }
          continue;
        }
        cursors[eEmit.effect] = idx + 1;
        outcome = recorded.result;
        value = standInValue(app.effects[eEmit.effect], outcome, recorded.value);
        source = "from-log";
      } else {
        outcome = mock.outcome;
        value = standInValue(app.effects[eEmit.effect], outcome, mock.value);
        source = "fixed";
      }
      if (
        emit({
          kind: "effect-end",
          episodeId: ep.id,
          stepIndex: 0,
          name: eEmit.effect,
          outcome,
          value,
          source,
        })
      ) {
        return { panics, unhandledErrors, stopped: true };
      }
      let matched = 0;
      for (const r of app.reducers) {
        if (
          r.event.kind === "effect" &&
          r.event.effect === eEmit.effect &&
          r.event.outcome === outcome
        ) {
          queue.push({
            reducer: r,
            payload: { $1: value, $2: eEmit.args?.[0] },
          });
          matched++;
        }
      }
      if (outcome === "err" && matched === 0) unhandledErrors.push({ effect: eEmit.effect });
    }
  }

  if (dirtyForEpisode.size > 0) {
    if (
      emit({
        kind: "signal-update",
        episodeId: ep.id,
        stepIndex: 0,
        dirty: [...dirtyForEpisode],
      })
    ) {
      return { panics, unhandledErrors, stopped: true };
    }
  }
  emit({ kind: "episode-end", episodeId: ep.id });
  return { panics, unhandledErrors, stopped: false };
}

/**
 * Replay an episode log against a compiled app, streaming each observed step
 * through `observer`. Powers `kumiki replay` (§10.5.3): mocks resolve effect
 * outcomes the same way `episode-test` does, `--until-step N` short-circuits
 * the run when the observer (or the executor's own counter) reports `"stop"`.
 *
 * The app's `live` state is reset to slot defaults at the start of replay; the
 * caller can read `finalSlots` afterwards (also written into `app.live`).
 */
export function replayEpisodes(input: {
  app: ReplayApp;
  episodes: EpisodeLogEntry[];
  mocks: Record<string, EpisodeMockPolicy>;
  observer: ReplayObserver;
  untilStep?: number;
}): ReplayReport {
  const { app, episodes, mocks, observer, untilStep } = input;
  resetLiveFromSlots(app);
  const panics: { episodeId: string; message: string }[] = [];
  const unhandledErrors: { episodeId: string; effect: string }[] = [];
  const stepCounter = { n: 0 };
  const envDrift: EnvDrift = { live: 0, unused: 0, malformed: 0 };
  const entryResultsMissing: ReplayReport["entryResultsMissing"] = [];
  const noting: ReplayObserver = (ev) => {
    if (ev.kind === "episode-start" && ev.entryResultMissing !== undefined) {
      entryResultsMissing.push({ episodeId: ev.episodeId, reducer: ev.entryResultMissing });
    }
    return observer(ev);
  };
  let stopped = false;
  for (const ep of episodes) {
    const r = executeEpisode(app, ep, mocks, noting, stepCounter, untilStep, envDrift);
    for (const p of r.panics) panics.push({ episodeId: ep.id, ...p });
    for (const u of r.unhandledErrors) unhandledErrors.push({ episodeId: ep.id, effect: u.effect });
    if (r.stopped) {
      stopped = true;
      break;
    }
  }
  const finalSlots: Record<string, unknown> = {};
  for (const k of Object.keys(app.slots)) finalSlots[k] = app.live[k];
  return {
    panics,
    unhandledErrors,
    stoppedAt: stopped ? stepCounter.n : null,
    finalSlots,
    envDrift,
    entryResultsMissing,
  };
}

export const _stdlibTest = {
  // ----- reducer-test `expect` wildcards (spec/testing.md §8.2.2) -----
  /** The wildcard map-key sentinel; codegen lowers a `<any-id>` map key to it. */
  WILD_KEY,
  /** The Set-literal wildcard count; codegen lowers the `<any-id>` members of a Set literal to it. */
  WILD_MEMBERS,
  /**
   * The `<slots.X>` members of a Set literal and keys of a Map literal; codegen collects
   * them under this key as `[sentinel, value]` pairs.
   */
  WILD_SLOT_KEYS,
  /** Build a value-position wildcard sentinel: `wild("any-id")` / `wild("slot", name)`. */
  wild(kind: "any-id" | "slot", slot?: string): Record<string, unknown> {
    return slot === undefined ? { [WILD]: kind } : { [WILD]: kind, slot };
  },
  /** Generate one value for a type descriptor (exposed for testing). */
  genValue(desc: GenDesc, rng: () => number): unknown {
    return genValue(desc, rng);
  },
  /**
   * Apply one reducer to a `{slots}` state and return the next `{slots}` — the
   * `run-reducer(name)` step used inside a `property-test` invariant (§8.3).
   * Pure w.r.t. the test: it seeds `app.live` from `state.slots`, applies, and
   * returns a fresh merged slots snapshot (emitted effects are ignored).
   *
   * Chained steps make this the one apply path where a rejection is easiest to
   * hide: `run-reducer(inc).run-reducer(dec)` reads its predecessor's output, so
   * a batch the app would refuse becomes the next step's starting state and the
   * invariant is checked against a world that cannot happen.
   *
   * A refused batch answers the state the step was given, and the trial it ran
   * in is told so ({@link trialRefusals}): the invariant then reads a state the
   * reducer did not commit, which `runPropertyTest` does not shrink toward.
   */
  runReducerStep(
    app: {
      live: Record<string, unknown>;
      slots: Record<string, SlotMetaLike>;
      reducers: ReducerSpec[];
    },
    state: { slots?: Record<string, unknown> } | undefined,
    name: string,
    event: Record<string, unknown>,
  ): { slots: Record<string, unknown> } {
    const slots = state?.slots ?? {};
    this.resetLive(app.live, app.slots, slots);
    const r = app.reducers.find((x) => x.name === name);
    if (!r) throw new Error(`reducer "${name}" not found`);
    const res = r.apply(app.live, { $el: event, $event: event });
    const rejected = batchRejections(res, app.slots);
    if (rejected.length > 0) {
      reportRejectedBatch(name, rejected);
      trialRefusals?.push({ reducer: name, rejected });
      return { slots: { ...slots } };
    }
    const next: Record<string, unknown> = { ...slots };
    for (const [k, v] of Object.entries(res.slots ?? {})) next[k] = v;
    return { slots: next };
  },
  /**
   * Run a `property-test` (spec/testing.md §8.3): generate `count` (default 100)
   * cases for the `vars` descriptors with a seeded PRNG (reproducible), check
   * `trial(binds) === true` each time, and on failure shrink to a minimal
   * counterexample (unless `shrink === false`).
   *
   * A trial in which a `run-reducer` batch was refused read a state the reducer
   * did not commit. Shrinking takes no such candidate as a smaller
   * counterexample; a generated case that is itself refused is reported as
   * generated, followed by the refusal.
   */
  runPropertyTest(input: {
    name: string;
    vars: Record<string, GenDesc>;
    trial: (binds: Record<string, unknown>) => boolean;
    count?: number;
    shrink?: boolean;
    seed?: number;
  }): TestResult {
    const { name, vars, trial } = input;
    const count = input.count ?? 100;
    const doShrink = input.shrink ?? true;
    const rng = _rng(input.seed ?? _hashStr(name));
    // Whether the invariant does NOT hold on `b` (a throw counts as a fail),
    // and the first step of the trial whose batch was refused.
    const attempt = (b: Record<string, unknown>): { fails: boolean; refused?: RefusedStep } => {
      const outer = trialRefusals;
      const refused: RefusedStep[] = [];
      trialRefusals = refused;
      try {
        let fails: boolean;
        try {
          fails = trial(b) !== true;
        } catch {
          fails = true;
        }
        return refused[0] ? { fails, refused: refused[0] } : { fails };
      } finally {
        trialRefusals = outer;
      }
    };
    const failsCommitted = (b: Record<string, unknown>): boolean => {
      const r = attempt(b);
      return r.fails && !r.refused;
    };
    for (let i = 0; i < count; i++) {
      const binds: Record<string, unknown> = {};
      for (const k of Object.keys(vars)) binds[k] = genValue(vars[k] as GenDesc, rng);
      const { fails, refused } = attempt(binds);
      if (fails) {
        const minimal =
          doShrink && !refused ? shrinkCounterexample(vars, failsCommitted, binds) : binds;
        const note = refused ? ` — ${rejectedBatchText(refused.reducer, refused.rejected)}` : "";
        return {
          name,
          pass: false,
          expected: "invariant holds for all generated inputs",
          actual: `counterexample (case ${i + 1}/${count}): ${_jsonStr(minimal)}${note}`,
          diffAt: "(property)",
          cases: i + 1,
        };
      }
    }
    return { name, pass: true, cases: count };
  },
  // ----- in-language test runner (`kumiki test`) -----
  /**
   * Reset live slot state to slot defaults, seed `route`, then apply the
   * test's `given` slots — with one further pass over `route`, because a
   * `given` one names only the fields the test cares about and takes the empty
   * route's values for the rest. `route.params` reading `undefined` is the
   * panic this seam exists to prevent, and an abbreviation must not
   * reintroduce it. The field names are checked when the program is checked.
   *
   * Shared by `reducer-test`, its multi-step form and `tile-test`, and by
   * `run-reducer` inside a `property-test`; `episode-test` and `kumiki replay`
   * reach the same seed through `resetLiveFromSlots`.
   */
  resetLive(
    live: Record<string, unknown>,
    slots: Record<string, { value: unknown }>,
    given: Record<string, unknown>,
  ): void {
    for (const k of Object.keys(live)) delete live[k];
    for (const [k, v] of Object.entries(slots)) live[k] = v.value;
    seedRoute(live);
    const base = live.route;
    Object.assign(live, given);
    const seeded = given.route;
    if (seeded && typeof seeded === "object" && !Array.isArray(seeded)) {
      live.route = { ...(base as Record<string, unknown>), ...(seeded as Record<string, unknown>) };
    }
  },
  /**
   * Compare a reducer's resulting slots + emitted effects (or a panic) to
   * `expect`. `slotMetas` carries the refinements: without them this tier would
   * accept a batch the running app refuses (runtime.md §10.3.3), which is the
   * one thing a reducer-test must never do.
   */
  runReducerTest(input: {
    name: string;
    target: string;
    givenSlots: Record<string, unknown>;
    slotMetas: Record<string, SlotMetaLike>;
    result: {
      slots: Record<string, unknown>;
      emits: { effect: string; args: unknown[] }[];
      rejected?: RefinementRejection[];
    } | null;
    panic: string | null;
    expect:
      | { kind: "panic"; message: string }
      | {
          kind: "state";
          slots: Record<string, unknown>;
          effects: { effect: string; args: unknown[]; argsSpecified?: boolean }[];
        };
  }): TestResult {
    const { name, target, givenSlots, slotMetas, result, panic, expect } = input;
    // No `?? {}` fallback: a caller that forgets `slotMetas` must throw here,
    // not silently lose every refinement check and pass a batch the app refuses.
    const rejected = batchRejections(result, slotMetas);
    if (rejected.length > 0) {
      reportRejectedBatch(target, rejected);
      return compareReducerExpect(name, { ...givenSlots }, [], panic, expect);
    }
    const finalSlots = { ...givenSlots, ...(result?.slots ?? {}) };
    return compareReducerExpect(name, finalSlots, result?.emits ?? [], panic, expect);
  },
  /**
   * Multi-step reducer-test with effect mocks (spec/testing.md §8.5). Dispatches
   * `target` headlessly, then drives the emit→result→reducer loop: an emitted
   * effect with a `mocks` entry is delivered to its `.ok`/`.err` reducer (its
   * result `value` as `$1`); one with no mock is *residual* and asserted via
   * `expect.effects`. `delay(ms, …)` is resolved immediately (virtualized time —
   * no real wait, FIFO order). A mocked `err` with no `.err` reducer fails the
   * test.
   */
  runReducerTestFlow(input: {
    name: string;
    app: ReplayApp;
    target: string;
    el: Record<string, unknown>;
    mocks: Record<string, { outcome: "ok" | "err"; value?: unknown; delayMs?: number }>;
    expect: ReducerExpect;
  }): TestResult {
    const { name, app, target, el, mocks, expect } = input;
    const { live, slots } = app;
    const residual: { effect: string; args: unknown[] }[] = [];
    const queue: { effect: string; outcome: "ok" | "err"; value: unknown }[] = [];
    let panic: string | null = null;
    let unhandledErr: string | null = null;

    // §10.3.3 all-or-nothing, as on the live path. Returns false when the batch
    // was rejected so the caller skips its emits — otherwise a reducer test
    // would see effects the running app would never have dispatched.
    const writeSlots = (
      reducerName: string,
      res: { slots?: Record<string, unknown>; rejected?: RefinementRejection[] } | undefined,
    ): boolean => {
      const rejected = batchRejections(res, slots);
      if (rejected.length > 0) {
        reportRejectedBatch(reducerName, rejected);
        return false;
      }
      for (const [k, v] of Object.entries(res?.slots ?? {})) live[k] = v;
      return true;
    };
    const enqueue = (emits: { effect: string; args: unknown[] }[] | undefined): void => {
      for (const emit of emits ?? []) {
        const m = mocks[emit.effect];
        if (m) {
          const value = standInValue(app.effects[emit.effect], m.outcome, m.value);
          queue.push({ effect: emit.effect, outcome: m.outcome, value });
        } else residual.push(emit);
      }
    };

    try {
      const tr = app.reducers.find((r) => r.name === target);
      if (!tr) throw new Error(`reducer ${target} not found`);
      const res0 = tr.apply(live, { $el: el, $event: el });
      if (writeSlots(tr.name, res0)) enqueue(res0.emits);
      let guard = 0;
      while (queue.length > 0 && guard++ < 10000) {
        const job = queue.shift();
        if (!job) break;
        let matched = 0;
        for (const r of app.reducers) {
          if (
            r.event.kind === "effect" &&
            r.event.effect === job.effect &&
            r.event.outcome === job.outcome
          ) {
            const res = r.apply(live, { $1: job.value, $2: undefined });
            if (writeSlots(r.name, res)) enqueue(res.emits);
            matched++;
          }
        }
        if (job.outcome === "err" && matched === 0 && unhandledErr === null) {
          unhandledErr = job.effect;
        }
      }
    } catch (e) {
      panic = e && (e as Error).message ? (e as Error).message : String(e);
    }
    return compareReducerExpect(name, { ...live }, residual, panic, expect, unhandledErr);
  },
  /**
   * Replay a recorded episode log against the current app (spec/testing.md §8.6).
   * For each Episode, dispatch the first `reducer` step's reducer with the
   * trigger payload and let the recorded emit → effect-end → .ok/.err chain
   * play out. Effect outcomes come from the caller's `mocks` map: `from-log`
   * consumes the next recorded effect-end value in order; `ignore` skips
   * delivery; `fixed` injects an explicit `{outcome, value}`. After every
   * episode replays, compare the live slots against `expect.slotsEqual` —
   * either a record literal or `"from-log"` (accumulated from each reducer
   * step's `slot-diffs`).
   *
   * Reuses {@link executeEpisode} (and `replayEpisodes`) — the same per-episode
   * executor drives both the assert-based `kumiki test` runner and the trace
   * formatter behind `kumiki replay` (spec/runtime.md §10.5.3), so a divergence
   * between the two is impossible.
   */
  runEpisodeTest(input: {
    name: string;
    app: ReplayApp;
    episodes: EpisodeLogEntry[];
    mocks: Record<string, EpisodeMockPolicy>;
    expect: {
      slotsEqual?: "from-log" | Record<string, unknown>;
      noPanics?: boolean;
      noErrors?: boolean;
    };
  }): TestResult {
    const { name, app, episodes, mocks, expect } = input;
    // Start from slot defaults so each test is hermetic (spec §8.6 expects the
    // log to be the sole driver of state).
    resetLiveFromSlots(app);

    const panics: { episodeId: string; message: string }[] = [];
    const unhandledErrors: string[] = [];
    const stepCounter = { n: 0 };
    const observer: ReplayObserver = () => "continue";
    // `episode-test` asserts against slots, not provenance; the drift is still
    // accumulated so the executor has one shape to write into.
    const envDrift: EnvDrift = { live: 0, unused: 0, malformed: 0 };

    for (const ep of episodes) {
      const r = executeEpisode(app, ep, mocks, observer, stepCounter, undefined, envDrift);
      for (const p of r.panics) panics.push({ episodeId: ep.id, ...p });
      for (const u of r.unhandledErrors) unhandledErrors.push(u.effect);
    }

    // Compute the from-log expectation from the recorded reducer slot-diffs.
    let expectedSlots: Record<string, unknown> | null = null;
    if (expect.slotsEqual === "from-log") {
      expectedSlots = {};
      for (const [k, m] of Object.entries(app.slots)) expectedSlots[k] = m.value;
      for (const ep of episodes) {
        for (const s of ep.steps) {
          if (s.kind === "reducer") {
            const diffs = (s as EpisodeReducerStep)["slot-diffs"] ?? [];
            for (const d of diffs) expectedSlots[d.name] = d.after;
          }
        }
      }
    } else if (expect.slotsEqual && typeof expect.slotsEqual === "object") {
      expectedSlots = expect.slotsEqual as Record<string, unknown>;
    }

    if (expectedSlots) {
      for (const [k, v] of Object.entries(expectedSlots)) {
        if (!valueEqual(app.live[k], v)) {
          return {
            name,
            pass: false,
            expected: _jsonStr(expectedSlots),
            actual: _jsonStr(app.live),
            diffAt: `slots.${k}`,
            leaf: { expected: v, actual: app.live[k] },
          };
        }
      }
    }
    if (expect.noPanics && panics.length > 0) {
      return {
        name,
        pass: false,
        expected: "no panics",
        actual: panics.map((p) => `${p.episodeId}: ${p.message}`).join("; "),
        diffAt: "panics",
      };
    }
    if (expect.noErrors && unhandledErrors.length > 0) {
      return {
        name,
        pass: false,
        expected: "no unhandled effect errors",
        actual: unhandledErrors.join(", "),
        diffAt: "errors",
      };
    }
    return { name, pass: true };
  },
  /** Structurally compare a rendered tile against the expected tile structure. */
  runTileTest(input: { name: string; actual: unknown; expected: unknown }): TestResult {
    const cmp = tileStructEqual(input.expected, input.actual);
    return {
      name: input.name,
      pass: cmp.ok,
      expected: serializeTileNode(input.expected),
      actual: serializeTileNode(input.actual, input.expected),
      ...(cmp.path ? { diffAt: cmp.path } : {}),
      ...(cmp.expectedLeaf !== undefined || cmp.actualLeaf !== undefined
        ? { leaf: { expected: cmp.expectedLeaf, actual: cmp.actualLeaf } }
        : {}),
    };
  },
};
