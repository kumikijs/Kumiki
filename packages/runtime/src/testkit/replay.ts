import {
  batchRejections,
  type EffectSpec,
  type EnvRead,
  emptyRoute,
  type PanicCategory,
  type PanicCauseLink,
  panicInfo,
  type ReducerSpec,
  type RefinementNaming,
  type RefinementRejection,
  reportRejectedBatch,
  standInValue,
  withEnvReplay,
} from "../core.ts";
import { valueEqual } from "../stdlib.ts";
import type {
  EpisodeLogEntry,
  EpisodeMockPolicy,
  EpisodeReducerStep,
  EpisodeStepLite,
} from "./episode-log.ts";

export type SlotMetaLike = { value: unknown; refine?: (v: unknown) => boolean } & RefinementNaming;

export type ReplayApp = {
  live: Record<string, unknown>;
  slots: Record<string, SlotMetaLike>;
  reducers: ReducerSpec[];
  effects: Record<string, Pick<EffectSpec, "errText">>;
};

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
  /** Episodes whose entry reducer's recorded result was not in the log. */
  entryResultsMissing: { episodeId: string; reducer: string }[];
};

export function seedRoute(live: Record<string, unknown>): void {
  if (!("route" in live)) live.route = emptyRoute();
}

/** Reset `app.live` to the slot defaults (hermetic start). */
export function resetLiveFromSlots(app: ReplayApp): void {
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

export function executeEpisode(
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
  // Reported rather than inferred: a trimmed or hand-edited log that
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
