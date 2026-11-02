import type {
  EpisodeLogEntry,
  EpisodeMockPolicy,
  ReplayEvent,
  ReplayReport,
  TestResult,
} from "@kumikijs/runtime";
import { _stdlibTest, dispatchFault, replayEpisodes } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { type ReplayableApp, replayableApp, replayInto } from "./helpers/episode-apps.ts";

function makeCounterApp(): ReplayableApp {
  return replayableApp({
    slots: { count: { value: 0 } },
    reducers: [
      {
        name: "inc",
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
      {
        name: "dec",
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { count: (live.count as number) - 1 }, emits: [] }),
      },
    ],
  });
}

function makeLoadUserApp(): ReplayableApp {
  return replayableApp({
    slots: { user: { value: null as unknown }, error: { value: null as unknown } },
    effects: {
      loadUser: {
        name: "loadUser",
        cap: "",
        invoke: async () => ({ kind: "ok", value: null }),
      },
    },
    reducers: [
      {
        name: "start",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "loadUser", args: [{ id: 1 }] }] }),
      },
      {
        name: "setUser",
        event: { kind: "effect", effect: "loadUser", outcome: "ok" },
        apply: (_live, payload) => ({ slots: { user: payload.$1 }, emits: [] }),
      },
      {
        name: "setError",
        event: { kind: "effect", effect: "loadUser", outcome: "err" },
        apply: (_live, payload) => ({ slots: { error: payload.$1 }, emits: [] }),
      },
    ],
  });
}

const incEpisode = (after: number): EpisodeLogEntry => ({
  id: `ep_${after}`,
  trigger: { kind: "ui.click", target: "IncBtn" },
  status: "completed",
  steps: [
    {
      kind: "reducer",
      name: "inc",
      "slot-diffs": [{ name: "count", before: after - 1, after }],
      emits: [],
    },
    { kind: "signal-update", "dirty-slots": ["count"] },
  ],
});

describe("_stdlibTest.runEpisodeTest", () => {
  it("PASSES when replay reaches the same final slots as the log (slots-equal: from-log)", () => {
    const app = makeCounterApp();
    const episodes = [incEpisode(1), incEpisode(2), incEpisode(3)];
    const result = _stdlibTest.runEpisodeTest({
      name: "counter-replay",
      app,
      episodes,
      mocks: {},
      expect: { slotsEqual: "from-log", noPanics: true },
    });
    expect(result.pass).toBe(true);
    expect(app.live?.count).toBe(3);
  });

  it("FAILS when reducer logic now produces a different final slot value", () => {
    const app = makeCounterApp();
    app.reducers[0]!.apply = (live) => ({ slots: { count: live.count as number }, emits: [] });
    const episodes = [incEpisode(1), incEpisode(2)];
    const result = _stdlibTest.runEpisodeTest({
      name: "counter-replay-tamper",
      app,
      episodes,
      mocks: {},
      expect: { slotsEqual: "from-log" },
    });
    expect(result.pass).toBe(false);
    expect(result.diffAt).toBe("slots.count");
    expect(result.leaf).toEqual({ expected: 2, actual: 0 });
  });

  it("replays recorded effect-end via mocks={effect: from-log} so the .ok reducer fires", () => {
    const app = makeLoadUserApp();
    const episode: EpisodeLogEntry = {
      id: "ep_load",
      trigger: { kind: "ui.click", target: "LoadBtn" },
      status: "completed",
      steps: [
        {
          kind: "reducer",
          name: "start",
          "slot-diffs": [],
          emits: ["loadUser"],
        },
        { kind: "effect-start", name: "loadUser", args: { id: 1 } },
        { kind: "effect-end", name: "loadUser", result: "ok", value: { id: 1, name: "Ada" } },
        {
          kind: "reducer",
          name: "setUser",
          "slot-diffs": [{ name: "user", before: null, after: { id: 1, name: "Ada" } }],
          emits: [],
        },
        { kind: "signal-update", "dirty-slots": ["user"] },
      ],
    };
    const mocks: Record<string, EpisodeMockPolicy> = { loadUser: { policy: "from-log" } };
    const result = _stdlibTest.runEpisodeTest({
      name: "load-user-replay",
      app,
      episodes: [episode],
      mocks,
      expect: { slotsEqual: "from-log", noPanics: true },
    });
    expect(result.pass).toBe(true);
    expect(app.live?.user).toEqual({ id: 1, name: "Ada" });
  });

  it("FAILS expect.no-panics when a reducer throws during replay", () => {
    const app = makeCounterApp();
    app.reducers[0]!.apply = () => {
      throw new Error("kaboom");
    };
    const result = _stdlibTest.runEpisodeTest({
      name: "panic-replay",
      app,
      episodes: [incEpisode(1)],
      mocks: {},
      expect: { noPanics: true },
    });
    expect(result.pass).toBe(false);
    expect(result.diffAt).toBe("panics");
    expect(result.actual).toContain("kaboom");
  });

  it("mocks={effect: ignore} drops the effect — neither .ok nor .err fires", () => {
    const app = makeLoadUserApp();
    const episode: EpisodeLogEntry = {
      id: "ep_load2",
      trigger: { kind: "ui.click", target: "LoadBtn" },
      status: "completed",
      steps: [
        { kind: "reducer", name: "start", "slot-diffs": [], emits: ["loadUser"] },
        { kind: "effect-end", name: "loadUser", result: "ok", value: { id: 1 } },
      ],
    };
    const result = _stdlibTest.runEpisodeTest({
      name: "ignore-replay",
      app,
      episodes: [episode],
      mocks: { loadUser: { policy: "ignore" } },
      expect: { slotsEqual: { user: null, error: null }, noPanics: true },
    });
    expect(result.pass).toBe(true);
    expect(app.live?.user).toBe(null);
  });
});

describe("an episode whose entry reducer is not in the program", () => {
  /**
   * The counter with `inc` renamed to `to`, and no `dec`: `dec` is 2 edits from `inc`, close
   * enough to add `— did you mean "dec"?` to every message below.
   */
  function renamedApp(to: string): ReplayableApp {
    return replayableApp({
      slots: { count: { value: 0 } },
      reducers: [
        {
          name: to,
          event: { kind: "ui", ev: "click" },
          apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
        },
      ],
    });
  }

  const crashedEpisode: EpisodeLogEntry = {
    id: "ep_crash",
    trigger: { kind: "ui.click", target: "IncBtn" },
    status: "panic",
    steps: [{ kind: "panic", name: "inc", message: "boom", category: "reducer" }],
  };

  function episodeTest(
    app: ReplayableApp,
    episodes: EpisodeLogEntry[],
    ex: Parameters<typeof _stdlibTest.runEpisodeTest>[0]["expect"],
  ): TestResult {
    return _stdlibTest.runEpisodeTest({ name: "renamed", app, episodes, mocks: {}, expect: ex });
  }

  const failed = (actual: string): TestResult => ({
    name: "renamed",
    pass: false,
    expected: "every episode replayed",
    actual,
    diffAt: "episodes",
  });

  /** The `episode-start` events a replay of `episodes` against `app` emits. */
  function startsOf(
    app: ReplayableApp,
    episodes: EpisodeLogEntry[],
  ): { starts: ReplayEvent[]; report: ReplayReport } {
    const starts: ReplayEvent[] = [];
    const report = replayInto(app, episodes, (ev) => {
      if (ev.kind === "episode-start") starts.push(ev);
      return "continue";
    });
    return { starts, report };
  }

  it.each([
    ["no-panics + no-errors", { noPanics: true, noErrors: true }],
    ["nothing", {}],
    ["slots-equal the unchanged slots", { slotsEqual: { count: 0 } }],
    ["slots-equal: from-log", { slotsEqual: "from-log" as const, noPanics: true }],
  ])("fails an episode-test naming the reducer, whatever expect names (%s)", (_, ex) => {
    const result = episodeTest(renamedApp("bump"), [incEpisode(1)], ex);
    expect(result).toEqual(failed('ep_1: no reducer named "inc"'));
  });

  it("fails an episode-test for an episode whose recorded panic names the reducer", () => {
    const result = episodeTest(renamedApp("bump"), [crashedEpisode], { noPanics: true });
    expect(result).toEqual(failed('ep_crash: no reducer named "inc"'));
  });

  it("names each such episode, and still replays the others", () => {
    const app = renamedApp("bump");
    const bumped: EpisodeLogEntry = {
      ...incEpisode(1),
      id: "ep_bump",
      steps: [{ kind: "reducer", name: "bump", "slot-diffs": [], emits: [] }],
    };
    const result = episodeTest(app, [incEpisode(1), bumped, crashedEpisode], {});
    expect(result).toEqual(
      failed('ep_1: no reducer named "inc"; ep_crash: no reducer named "inc"'),
    );
    expect(app.live.count).toBe(1);
    expect(replayInto(app, [incEpisode(1), bumped, crashedEpisode]).replayed).toBe(1);
  });

  it("reports the episode on its start event and in the replay report", () => {
    const { starts, report } = startsOf(renamedApp("bump"), [incEpisode(1)]);
    const missing = { reducer: "inc", message: 'no reducer named "inc"' };
    expect(starts).toEqual([
      {
        kind: "episode-start",
        episodeId: "ep_1",
        trigger: incEpisode(1).trigger,
        entryReducerMissing: missing,
      },
    ]);
    expect(report.entryReducersMissing).toEqual([{ episodeId: "ep_1", ...missing }]);
    expect(report.finalSlots).toEqual({ count: 0 });
    expect(report.replayed).toBe(0);
  });

  it("says it in the words a `{dispatch}` step naming no reducer does", () => {
    const report = replayInto(renamedApp("incr"), [incEpisode(1)]);
    const message = dispatchFault("inc", {}, [{ name: "incr", id: null }]);
    expect(message).toBe('no reducer named "inc" — did you mean "incr"?');
    expect(report.entryReducersMissing).toEqual([{ episodeId: "ep_1", reducer: "inc", message }]);
  });

  it("names every reducer tied at the closest distance, as a `{dispatch}` step does", () => {
    const app = replayableApp({
      slots: { count: { value: 0 } },
      reducers: ["incb", "inca"].map((name) => ({
        name,
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [] }),
      })),
    });
    const message = 'no reducer named "inc" — did you mean "inca" or "incb"?';
    expect(replayInto(app, [incEpisode(1)]).entryReducersMissing).toEqual([
      { episodeId: "ep_1", reducer: "inc", message },
    ]);
  });

  it("reports a renamed `.ok` entry reducer of a bootstrap as not replayed, not as missing its result", () => {
    const bootstrap: EpisodeLogEntry = {
      id: "ep_boot",
      trigger: { kind: "ssr.hydrate", target: "/" },
      status: "completed",
      steps: [
        { kind: "effect-start", name: "loadUser", args: [{ id: 1 }] },
        { kind: "effect-end", name: "loadUser", result: "ok", value: { id: 1 } },
        {
          kind: "reducer",
          name: "userLoaded",
          "slot-diffs": [{ name: "user", before: null, after: { id: 1 } }],
          emits: [],
        },
      ],
    };
    const { starts, report } = startsOf(makeLoadUserApp(), [bootstrap]);
    expect(starts).toStrictEqual([
      {
        kind: "episode-start",
        episodeId: "ep_boot",
        trigger: bootstrap.trigger,
        entryReducerMissing: { reducer: "userLoaded", message: 'no reducer named "userLoaded"' },
      },
    ]);
    expect(report.entryResultsMissing).toEqual([]);
  });

  it("reports an entry `reducer` step with no name, rather than throwing or replaying it clean", () => {
    // A hand-edited log: nothing checks a log line's shape before replay reads it.
    const episodes = [
      '{"id":"ep_anon","trigger":{"kind":"ui.click","target":"IncBtn"},"status":"completed","steps":[{"kind":"reducer","slot-diffs":[],"emits":[]}]}',
      '{"id":"ep_boot","trigger":{"kind":"ssr.hydrate","target":"/"},"status":"completed","steps":[{"kind":"effect-start","name":"ping"},{"kind":"effect-end","name":"ping","result":"ok","value":null},{"kind":"reducer","name":7,"slot-diffs":[],"emits":[]}]}',
    ].map((line) => JSON.parse(line) as EpisodeLogEntry);
    expect(episodeTest(renamedApp("bump"), episodes, { noPanics: true })).toEqual(
      failed("ep_anon: reducer step 1 has no name; ep_boot: reducer step 3 has no name"),
    );
    expect(startsOf(renamedApp("bump"), episodes).report.entryReducersMissing).toStrictEqual([
      { episodeId: "ep_anon", message: "reducer step 1 has no name" },
      { episodeId: "ep_boot", message: "reducer step 3 has no name" },
    ]);
  });

  it("reports an episode with no entry step whose trigger is not an `ssr.hydrate` bootstrap", () => {
    // The live runtime opens every other episode at a reducer and records it, so a log without
    // one was trimmed or edited: a crash logged as a `panic` with no `name`, or no steps at all.
    const trimmed = (id: string, steps: EpisodeLogEntry["steps"]): EpisodeLogEntry => ({
      id,
      trigger: { kind: "ui.click", target: "IncBtn" },
      status: "completed",
      steps,
    });
    const episodes = [
      trimmed("ep_empty", []),
      trimmed("ep_crash", [{ kind: "panic", message: "boom", location: 'reducer "inc"' }]),
    ];
    const app = renamedApp("inc");
    expect(episodeTest(app, episodes, { noPanics: true })).toEqual(
      failed("ep_empty: no reducer step; ep_crash: no reducer step"),
    );
    expect(app.live.count).toBe(0);
  });

  const noEntryReducer: [string, EpisodeLogEntry["steps"]][] = [
    [
      "an `app.init` result no reducer handles",
      [
        { kind: "effect-start", name: "ping", args: null },
        { kind: "effect-end", name: "ping", result: "ok", value: null },
      ],
    ],
    [
      "a capability refusal, whose `panic` step names no reducer",
      [
        {
          kind: "panic",
          message: 'capability "http" is not declared in app.caps',
          location: 'effect "ping"',
          category: "capability",
        },
      ],
    ],
  ];

  it.each(
    noEntryReducer,
  )("replays a bootstrap with no entry reducer at all as clean (%s)", (_, steps) => {
    const bootstrap: EpisodeLogEntry = {
      id: "ep_boot",
      trigger: { kind: "ssr.hydrate", target: "/" },
      status: "completed",
      steps,
    };
    const app = renamedApp("bump");
    expect(episodeTest(app, [bootstrap], { noPanics: true, noErrors: true })).toEqual({
      name: "renamed",
      pass: true,
    });
    expect(app.live.count).toBe(0);
  });
});

describe("ReplayReport.replayed", () => {
  it("counts the episodes replay ran, stopping with the one --until-step stopped in", () => {
    const run = (untilStep?: number) =>
      replayEpisodes({
        app: makeCounterApp(),
        episodes: [incEpisode(1), incEpisode(2), incEpisode(3)],
        mocks: {},
        observer: () => "continue",
        ...(untilStep !== undefined ? { untilStep } : {}),
      }).replayed;
    expect([run(), run(1), run(3)]).toEqual([3, 1, 2]);
  });
});
