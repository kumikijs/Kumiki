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
  reportRejectedBatch,
  withEnvReplay,
} from "./core.ts";
import { valueEqual } from "./stdlib.ts";

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
   * The values at the divergence point, when the runner can isolate one.
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

// `@@`-prefixed sentinels never collide with a Kumiki field name.
const WILD = "@@kumiki:wild";
/** A wildcard map key (`<any-id>` in key position): pairs with the one generated entry. */
const WILD_KEY = "@@kumiki:wild-key";
/** How many `<any-id>` members a Set literal has: each pairs with one generated member. */
const WILD_MEMBERS = "@@kumiki:wild-members";
/**
 * The `<slots.X>` keys of a Set or Map literal, as `[sentinel, value]` pairs: keyed only once the slots are known.
 */
const WILD_SLOT_KEYS = "@@kumiki:wild-slot-keys";

function isWildValue(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && Object.hasOwn(v, WILD);
}

/** The value a `<slots.X>` sentinel stands for: slot X after execution. */
function slotWildValue(w: Record<string, unknown>, finalSlots: Record<string, unknown>): unknown {
  return finalSlots[w.slot as string];
}

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

const TILE_PROPS_NOT_CONTENT: ReadonlySet<string> = new Set(["el", "_tile", "class", "style"]);

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

function genValue(desc: GenDesc, rng: () => number): unknown {
  // `one-of` names the whole domain, whatever the base type is, so it is answered ahead of the type it refines.
  if ("oneOf" in desc && desc.oneOf && desc.oneOf.length > 0) {
    return desc.oneOf[Math.floor(rng() * desc.oneOf.length)];
  }
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

/** Candidate values "simpler" than `v`, for shrinking a counterexample. */
function _shrink(v: unknown): unknown[] {
  if (typeof v === "number") {
    if (v === 0) return [];
    const half = Math.trunc(v / 2);
    return half === 0 ? [0] : [0, half];
  }
  if (typeof v === "string") {
    if (v === "") return [];
    return ["", v.slice(0, Math.floor(v.length / 2))];
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    const out: unknown[] = [[]];
    for (let i = 0; i < v.length; i++) out.push([...v.slice(0, i), ...v.slice(i + 1)]);
    return out;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("_tag" in o) return o._tag === "Some" ? [{ _tag: "None" }] : [];
    const keys = Object.keys(o);
    if (keys.length === 0) return [];
    const out: unknown[] = [{}];
    for (const k of keys) {
      const cp = { ...o };
      delete cp[k];
      out.push(cp);
    }
    return out;
  }
  return [];
}

/** Greedily minimize a failing binding set, holding each var's failure. */
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
    for (const k of Object.keys(vars)) {
      for (const cand of _shrink(cur[k])) {
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

type SlotMetaLike = { value: unknown; refine?: (v: unknown) => boolean } & RefinementNaming;

export type ReplayApp = {
  live: Record<string, unknown>;
  slots: Record<string, SlotMetaLike>;
  reducers: ReducerSpec[];
  effects: Record<string, Pick<EffectSpec, "errText">>;
};

export function standInValue(
  eff: Pick<EffectSpec, "errText"> | undefined,
  outcome: "ok" | "err",
  value: unknown,
): unknown {
  return outcome === "err" && eff?.errText ? eff.errText(value) : (value ?? null);
}

export type ReplayEvent =
  | {
      kind: "episode-start";
      episodeId: string;
      trigger: { kind: string; target?: string; payload?: unknown };
      /**
       * The entry reducer, when it is an `.ok` / `.err` reducer whose value the log does not carry: it runs with no `$1`.
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
       * Where this body's environment reads came from.
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

export type ReplayObserver = (event: ReplayEvent) => "continue" | "stop";

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
   * Effect emits whose `.err` outcome had no `.err` reducer to catch.
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

function seedRoute(live: Record<string, unknown>): void {
  if (!("route" in live)) live.route = emptyRoute();
}

/** Reset `app.live` to the slot defaults (hermetic start, §8.6). */
function resetLiveFromSlots(app: ReplayApp): void {
  for (const k of Object.keys(app.live)) delete app.live[k];
  for (const [k, m] of Object.entries(app.slots)) app.live[k] = m.value;
  seedRoute(app.live);
}

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
  // Accumulated across episodes by the caller, for the same reason `stepCounter` is: every `return` below would otherwise have to carry it.
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
  /** The wildcard map-key sentinel; codegen lowers a `<any-id>` map key to it. */
  WILD_KEY,
  /** The Set-literal wildcard count; codegen lowers the `<any-id>` members of a Set literal to it. */
  WILD_MEMBERS,
  /**
   * The `<slots.X>` members of a Set literal and keys of a Map literal.
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
      return { slots: { ...slots } };
    }
    const next: Record<string, unknown> = { ...slots };
    for (const [k, v] of Object.entries(res.slots ?? {})) next[k] = v;
    return { slots: next };
  },
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
    // `fails` is true when the invariant does NOT hold (a throw counts as a fail).
    const fails = (b: Record<string, unknown>): boolean => {
      try {
        return trial(b) !== true;
      } catch {
        return true;
      }
    };
    for (let i = 0; i < count; i++) {
      const binds: Record<string, unknown> = {};
      for (const k of Object.keys(vars)) binds[k] = genValue(vars[k] as GenDesc, rng);
      if (fails(binds)) {
        const minimal = doShrink ? shrinkCounterexample(vars, fails, binds) : binds;
        return {
          name,
          pass: false,
          expected: "invariant holds for all generated inputs",
          actual: `counterexample (case ${i + 1}/${count}): ${_jsonStr(minimal)}`,
          diffAt: "(property)",
          cases: i + 1,
        };
      }
    }
    return { name, pass: true, cases: count };
  },
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
    // No `?? {}` fallback: a caller that forgets `slotMetas` must throw here, not silently lose every refinement check and pass a batch the app refuses.
    const rejected = batchRejections(result, slotMetas);
    if (rejected.length > 0) {
      reportRejectedBatch(target, rejected);
      return compareReducerExpect(name, { ...givenSlots }, [], panic, expect);
    }
    const finalSlots = { ...givenSlots, ...(result?.slots ?? {}) };
    return compareReducerExpect(name, finalSlots, result?.emits ?? [], panic, expect);
  },
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
    resetLiveFromSlots(app);

    const panics: { episodeId: string; message: string }[] = [];
    const unhandledErrors: string[] = [];
    const stepCounter = { n: 0 };
    const observer: ReplayObserver = () => "continue";
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
