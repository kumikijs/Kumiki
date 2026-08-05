// Test harness slice of the stdlib (#71): reducer-test / property-test /
// tile-test runners and the §8.2.2 `expect` wildcards. Only `kumiki test` /
// smoke-tier code paths reach these, so they live apart from `stdlib.ts` —
// `kumiki build` output never ships them. `index.ts` merges this back into the
// classic `_stdlib` export for the inlining (full-bundle) path.

import {
  type PanicCategory,
  type PanicCauseLink,
  panicInfo,
  type ReducerSpec,
  refinementRejections,
  reportRejectedBatch,
} from "./core.ts";

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
   * The scalar values at the divergence point (`diffAt`), when the runner can
   * isolate one. Powers the §8.7.1 value arrow (`expected -> actual`) and lets
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

/** Deep structural equality for slot values (records / lists / primitives). */
function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    return a.every((x, i) => deepEqualValue(x, (b as unknown[])[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  // Compare key presence too — `{a: undefined}` and `{b: undefined}` have equal
  // key counts but are not equal.
  return ak.every((k) => Object.hasOwn(bo, k) && deepEqualValue(ao[k], bo[k]));
}

// ----- reducer-test `expect` wildcards (spec/testing.md §8.2.2) -----
// `@@`-prefixed sentinels never collide with a Kumiki field name (identifiers
// are alphanumeric + hyphen, so `@` can never appear in one).
const WILD = "@@kumiki:wild";
/** A wildcard map key (`<any-id>` in key position): pairs with the one generated entry. */
const WILD_KEY = "@@kumiki:wild-key";

function isWildValue(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && Object.hasOwn(v, WILD);
}

/**
 * Wildcard-aware structural match for reducer-test `expect` (§8.2.2). Records are
 * matched by exact key set; `<any-id>` (value) matches any present value, a
 * `<any-id>` map key pairs with exactly one otherwise-unmatched entry (0 or >1 →
 * fail), and `<slots.X>` matches slot X's post-execution value. Falls back to
 * deep equality when no wildcard is involved.
 */
function wildcardEqual(
  expected: unknown,
  actual: unknown,
  finalSlots: Record<string, unknown>,
): boolean {
  if (isWildValue(expected)) {
    const kind = expected[WILD];
    if (kind === "any-id") return actual !== undefined;
    if (kind === "slot") return deepEqualValue(actual, finalSlots[expected.slot as string]);
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
  const eo = expected as Record<string, unknown>;
  const ao = actual as Record<string, unknown>;
  const literalKeys = Object.keys(eo).filter((k) => k !== WILD_KEY);
  for (const k of literalKeys) {
    if (!Object.hasOwn(ao, k) || !wildcardEqual(eo[k], ao[k], finalSlots)) return false;
  }
  const leftover = Object.keys(ao).filter((k) => !literalKeys.includes(k));
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
 * Structural tile comparison for tile-tests: compares `kind`, `text`, and
 * `children` recursively. Props (styles, onClick handlers, …) are out of scope,
 * per spec §8.4. Returns the first differing path on mismatch.
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
  if (tileField(expected, "text") !== undefined) {
    const et = String(tileField(expected, "text"));
    const at = String(tileField(actual, "text"));
    if (et !== at) {
      // Carry the scalar leaf values so the runner can print the §8.7.1 value
      // arrow and `kumiki fix --auto-patch` can locate the responsible literal.
      return { ok: false, path: `${here}.text`, expectedLeaf: et, actualLeaf: at };
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

function serializeTileNode(node: unknown): string {
  if (node == null) return "null";
  const kind = String(tileField(node, "kind"));
  const kids = tileChildren(node);
  if (tileField(node, "text") !== undefined && kids.length === 0) {
    return `${kind}(${_jsonStr(tileField(node, "text"))})`;
  }
  if (kids.length === 0) return `${kind}()`;
  return `${kind}(${kids.map(serializeTileNode).join(", ")})`;
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
  | { t: "Int"; min?: number; max?: number }
  | { t: "Float"; min?: number; max?: number }
  | { t: "Text"; minLen?: number; maxLen?: number }
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

function genValue(desc: GenDesc, rng: () => number): unknown {
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

// ----- shared per-episode executor (spec/testing.md §8.6 + runtime.md §10.5.3) -----
// Drives the reducer queue, applies effect mocks, and emits observer events.
// Both `runEpisodeTest` (assert) and `replayEpisodes` (trace) call this — a
// single implementation keeps `from-log` cursor / refine ward / unhandled-err
// accounting from drifting between the test runner and the CLI replay verb.

/** The minimum app shape `executeEpisode` / `replayEpisodes` consume. */
export type ReplayApp = {
  live: Record<string, unknown>;
  slots: Record<string, { value: unknown; refine?: (v: unknown) => boolean }>;
  reducers: ReducerSpec[];
};

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
    }
  | {
      kind: "reducer";
      episodeId: string;
      stepIndex: number;
      name: string;
      slotDiffs: { name: string; before: unknown; after: unknown }[];
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
};

/** Reset `app.live` to the slot defaults (hermetic start, §8.6). */
function resetLiveFromSlots(app: ReplayApp): void {
  for (const k of Object.keys(app.live)) delete app.live[k];
  for (const [k, m] of Object.entries(app.slots)) app.live[k] = m.value;
}

function executeEpisode(
  app: ReplayApp,
  ep: EpisodeLogEntry,
  mocks: Record<string, EpisodeMockPolicy>,
  observer: ReplayObserver,
  stepCounter: { n: number },
  untilStep: number | undefined,
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
    resSlots: Record<string, unknown> | undefined,
  ): { name: string; before: unknown; after: unknown }[] | null => {
    const rejected = refinementRejections(resSlots ?? {}, app.slots);
    if (rejected.length > 0) {
      reportRejectedBatch(reducerName, rejected);
      return null;
    }
    const diffs: { name: string; before: unknown; after: unknown }[] = [];
    for (const [k, v] of Object.entries(resSlots ?? {})) {
      const before = app.live[k];
      app.live[k] = v;
      if (!deepEqualValue(before, v)) diffs.push({ name: k, before, after: v });
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

  if (emit({ kind: "episode-start", episodeId: ep.id, trigger: ep.trigger })) {
    return { panics, unhandledErrors, stopped: true };
  }

  const firstRed = ep.steps.find((s): s is EpisodeReducerStep => s.kind === "reducer");
  if (!firstRed) {
    emit({ kind: "episode-end", episodeId: ep.id });
    return { panics, unhandledErrors, stopped: false };
  }
  const entry = app.reducers.find((r) => r.name === firstRed.name);
  if (!entry) {
    emit({ kind: "episode-end", episodeId: ep.id });
    return { panics, unhandledErrors, stopped: false };
  }

  // Per-effect FIFO of recorded effect-end values for `from-log` mocks.
  const recordedResults: Record<string, { result: "ok" | "err"; value: unknown }[]> = {};
  for (const s of ep.steps) {
    if (s.kind === "effect-end") {
      const list = recordedResults[s.name] ?? [];
      list.push({ result: s.result, value: s.value });
      recordedResults[s.name] = list;
    }
  }
  const cursors: Record<string, number> = {};

  const triggerPayload = (ep.trigger.payload as Record<string, unknown> | undefined) ?? {};
  const queue: { reducer: ReducerSpec; payload: Record<string, unknown> }[] = [
    { reducer: entry, payload: { $el: triggerPayload, $event: triggerPayload } },
  ];

  let guard = 0;
  const dirtyForEpisode = new Set<string>();

  while (queue.length > 0 && guard++ < 10000) {
    const job = queue.shift();
    if (!job) break;
    let res: ReturnType<ReducerSpec["apply"]>;
    try {
      res = job.reducer.apply(app.live, job.payload);
    } catch (e) {
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
    const written = writeSlots(job.reducer.name, res.slots);
    const diffs = written ?? [];
    for (const d of diffs) dirtyForEpisode.add(d.name);
    if (
      emit({
        kind: "reducer",
        episodeId: ep.id,
        stepIndex: 0,
        name: job.reducer.name,
        slotDiffs: diffs,
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
        value = recorded.value;
        source = "from-log";
      } else {
        outcome = mock.outcome;
        value = mock.value;
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
  let stopped = false;
  for (const ep of episodes) {
    const r = executeEpisode(app, ep, mocks, observer, stepCounter, untilStep);
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
  };
}

export const _stdlibTest = {
  // ----- reducer-test `expect` wildcards (spec/testing.md §8.2.2) -----
  /** The wildcard map-key sentinel; codegen lowers a `<any-id>` map key to it. */
  WILD_KEY,
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
   */
  runReducerStep(
    app: {
      live: Record<string, unknown>;
      slots: Record<string, { value: unknown; refine?: (v: unknown) => boolean }>;
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
    const next: Record<string, unknown> = { ...slots };
    for (const [k, v] of Object.entries(res.slots ?? {})) next[k] = v;
    return { slots: next };
  },
  /**
   * Run a `property-test` (spec/testing.md §8.3): generate `count` (default 100)
   * cases for the `vars` descriptors with a seeded PRNG (reproducible), check
   * `trial(binds) === true` each time, and on failure shrink to a minimal
   * counterexample (unless `shrink === false`).
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
  // ----- in-language test runner (`kumiki test`) -----
  /** Reset live slot state to slot defaults, then apply the test's `given` slots. */
  resetLive(
    live: Record<string, unknown>,
    slots: Record<string, { value: unknown }>,
    given: Record<string, unknown>,
  ): void {
    for (const k of Object.keys(live)) delete live[k];
    for (const [k, v] of Object.entries(slots)) live[k] = v.value;
    Object.assign(live, given);
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
    slotMetas: Record<string, { value: unknown; refine?: (v: unknown) => boolean }>;
    result: { slots: Record<string, unknown>; emits: { effect: string; args: unknown[] }[] } | null;
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
    const rejected = refinementRejections(result?.slots ?? {}, slotMetas ?? {});
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
    app: {
      live: Record<string, unknown>;
      slots: Record<string, { value: unknown; refine?: (v: unknown) => boolean }>;
      reducers: ReducerSpec[];
    };
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
      resSlots: Record<string, unknown> | undefined,
    ): boolean => {
      const rejected = refinementRejections(resSlots ?? {}, slots);
      if (rejected.length > 0) {
        reportRejectedBatch(reducerName, rejected);
        return false;
      }
      for (const [k, v] of Object.entries(resSlots ?? {})) live[k] = v;
      return true;
    };
    const enqueue = (emits: { effect: string; args: unknown[] }[] | undefined): void => {
      for (const emit of emits ?? []) {
        const m = mocks[emit.effect];
        if (m) queue.push({ effect: emit.effect, outcome: m.outcome, value: m.value ?? null });
        else residual.push(emit);
      }
    };

    try {
      const tr = app.reducers.find((r) => r.name === target);
      if (!tr) throw new Error(`reducer ${target} not found`);
      const res0 = tr.apply(live, { $el: el, $event: el });
      if (writeSlots(tr.name, res0.slots)) enqueue(res0.emits);
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
            if (writeSlots(r.name, res.slots)) enqueue(res.emits);
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
    app: {
      live: Record<string, unknown>;
      slots: Record<string, { value: unknown; refine?: (v: unknown) => boolean }>;
      reducers: ReducerSpec[];
    };
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

    for (const ep of episodes) {
      const r = executeEpisode(app, ep, mocks, observer, stepCounter, undefined);
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
        if (!deepEqualValue(app.live[k], v)) {
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
      actual: serializeTileNode(input.actual),
      ...(cmp.path ? { diffAt: cmp.path } : {}),
      ...(cmp.expectedLeaf !== undefined || cmp.actualLeaf !== undefined
        ? { leaf: { expected: cmp.expectedLeaf, actual: cmp.actualLeaf } }
        : {}),
    };
  },
};
