import type {
  EpisodeLogEntry,
  EpisodeMockPolicy,
  ReplayEvent,
  TestResult,
} from "@kumikijs/runtime";
import { _stdlibTest, dispatchFault, replayEpisodes } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { type ReplayableApp, replayableApp } from "./helpers/episode-apps.ts";

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
  function renamedApp(to: string): ReplayableApp {
    const app = makeCounterApp();
    app.reducers = app.reducers.filter((r) => r.name === "inc").map((r) => ({ ...r, name: to }));
    return app;
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
  });

  it("reports the episode on its start event and in the replay report", () => {
    const app = renamedApp("bump");
    const starts: ReplayEvent[] = [];
    const report = replayEpisodes({
      app,
      episodes: [incEpisode(1)],
      mocks: {},
      observer: (ev) => {
        if (ev.kind === "episode-start") starts.push(ev);
        return "continue";
      },
    });
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
  });

  it("says it in the words a `{dispatch}` step naming no reducer does", () => {
    const report = replayEpisodes({
      app: renamedApp("incr"),
      episodes: [incEpisode(1)],
      mocks: {},
      observer: () => "continue",
    });
    const message = dispatchFault("inc", {}, [{ name: "incr", id: null }]);
    expect(message).toBe('no reducer named "inc" — did you mean "incr"?');
    expect(report.entryReducersMissing).toEqual([{ episodeId: "ep_1", reducer: "inc", message }]);
  });

  it("replays an episode with no entry reducer at all as clean", () => {
    // An `ssr.hydrate` bootstrap whose `app.init` result no reducer handles.
    const bootstrap: EpisodeLogEntry = {
      id: "ep_boot",
      trigger: { kind: "ssr.hydrate", target: "/" },
      status: "completed",
      steps: [
        { kind: "effect-start", name: "ping", args: null },
        { kind: "effect-end", name: "ping", result: "ok", value: null },
      ],
    };
    const app = renamedApp("bump");
    expect(episodeTest(app, [bootstrap], { noPanics: true, noErrors: true })).toEqual({
      name: "renamed",
      pass: true,
    });
    expect(app.live.count).toBe(0);
  });
});
