import {
  batchRejections,
  type ReducerSpec,
  type RefinementRejection,
  reportRejectedBatch,
} from "./core.ts";
import { valueEqual } from "./stdlib.ts";
import type {
  EpisodeLogEntry,
  EpisodeMockPolicy,
  EpisodeReducerStep,
} from "./testkit/episode-log.ts";
import {
  _jsonStr,
  compareReducerExpect,
  type ReducerExpect,
  type TestResult,
} from "./testkit/expect.ts";
import {
  _hashStr,
  _rng,
  type GenDesc,
  genValue,
  shrinkCounterexample,
} from "./testkit/generate.ts";
import {
  type EnvDrift,
  executeEpisode,
  type ReplayApp,
  type ReplayObserver,
  resetLiveFromSlots,
  type SlotMetaLike,
  seedRoute,
  standInValue,
} from "./testkit/replay.ts";
import { serializeTileNode, tileStructEqual } from "./testkit/tile-match.ts";
import { WILD, WILD_KEY, WILD_MEMBERS, WILD_SLOT_KEYS } from "./testkit/wildcard.ts";

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
export type { EpisodeLogEntry, EpisodeMockPolicy } from "./testkit/episode-log.ts";
export type { TestResult } from "./testkit/expect.ts";
export type { GenDesc } from "./testkit/generate.ts";
export {
  type EnvDrift,
  type ReplayApp,
  type ReplayEvent,
  type ReplayObserver,
  type ReplayReport,
  replayEpisodes,
  standInValue,
} from "./testkit/replay.ts";
