import type { AppShape, EpisodeLogEntry, EpisodeMockPolicy } from "@kumikijs/runtime";
import { _stdlibTest } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

/** An app whose `live` map is already populated, which is what replay needs. */
type ReplayableApp = AppShape & { live: Record<string, unknown> };

function makeCounterApp(): ReplayableApp {
  const slots = {
    count: { value: 0 },
  };
  const app: ReplayableApp = {
    live: {},
    slots,
    caps: [],
    effects: {},
    init: [],
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
    root: () => ({ kind: "text", text: "" }),
  };
  for (const [k, m] of Object.entries(slots)) app.live[k] = m.value;
  return app;
}

function makeLoadUserApp(): ReplayableApp {
  const slots = {
    user: { value: null as unknown },
    error: { value: null as unknown },
  };
  const app: ReplayableApp = {
    live: {},
    slots,
    caps: [],
    effects: {
      loadUser: {
        name: "loadUser",
        cap: "",
        invoke: async () => ({ kind: "ok", value: null }),
      },
    },
    init: [],
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
    root: () => ({ kind: "text", text: "" }),
  };
  for (const [k, m] of Object.entries(slots)) app.live[k] = m.value;
  return app;
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

describe("_stdlibTest.runEpisodeTest (§8.6)", () => {
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
    // Tamper: replace `inc` with a no-op so replay can't reach count=2.
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

/** The counter app whose `inc` throws on every replay. */
function makePanickingCounterApp(): ReplayableApp {
  const app = makeCounterApp();
  app.reducers[0]!.apply = () => {
    throw new Error("kaboom");
  };
  return app;
}

/**
 * A `loadUser` that failed, recorded while `setError` caught it. Replayed
 * against {@link makeLoadUserApp} with `setError` removed, the err reaches no
 * `.err` reducer and `error` keeps its default.
 */
const failedLoadEpisode: EpisodeLogEntry = {
  id: "ep_fail",
  trigger: { kind: "ui.click", target: "LoadBtn" },
  status: "completed",
  steps: [
    { kind: "reducer", name: "start", "slot-diffs": [], emits: ["loadUser"] },
    { kind: "effect-end", name: "loadUser", result: "err", value: "offline" },
    {
      kind: "reducer",
      name: "setError",
      "slot-diffs": [{ name: "error", before: null, after: "offline" }],
      emits: [],
    },
  ],
};

function makeDroppingLoadUserApp(): ReplayableApp {
  const app = makeLoadUserApp();
  app.reducers = app.reducers.filter((r) => r.name !== "setError");
  return app;
}

describe("_stdlibTest.runEpisodeTest reports the failure behind a slot divergence (§8.6)", () => {
  it.each([
    ["a record", { count: 1 }],
    ["from-log", "from-log" as const],
  ])("reports a replay panic as the panic when `slots-equal` is %s", (_, slotsEqual) => {
    const result = _stdlibTest.runEpisodeTest({
      name: "panic-and-slots",
      app: makePanickingCounterApp(),
      episodes: [incEpisode(1)],
      mocks: {},
      expect: { slotsEqual, noPanics: true },
    });
    expect(result).toEqual({
      name: "panic-and-slots",
      pass: false,
      expected: "no panics",
      actual: "ep_1: kaboom",
      diffAt: "panics",
    });
  });

  it("reports a dropped err as the error when `slots-equal` names the slot `.err` would write", () => {
    const result = _stdlibTest.runEpisodeTest({
      name: "dropped-err-and-slots",
      app: makeDroppingLoadUserApp(),
      episodes: [failedLoadEpisode],
      mocks: { loadUser: { policy: "from-log" } },
      expect: { slotsEqual: "from-log", noErrors: true },
    });
    expect(result).toEqual({
      name: "dropped-err-and-slots",
      pass: false,
      expected: "no unhandled effect errors",
      actual: "loadUser",
      diffAt: "errors",
    });
  });

  it("reports a panic ahead of a dropped err when `expect` names both", () => {
    const app = makeDroppingLoadUserApp();
    const setUser = app.reducers.find((r) => r.name === "setUser")!;
    setUser.apply = () => {
      throw new Error("kaboom");
    };
    const loaded: EpisodeLogEntry = {
      id: "ep_ok",
      trigger: { kind: "ui.click", target: "LoadBtn" },
      status: "completed",
      steps: [
        { kind: "reducer", name: "start", "slot-diffs": [], emits: ["loadUser"] },
        { kind: "effect-end", name: "loadUser", result: "ok", value: { id: 1 } },
        {
          kind: "reducer",
          name: "setUser",
          "slot-diffs": [{ name: "user", before: null, after: { id: 1 } }],
          emits: [],
        },
      ],
    };
    const result = _stdlibTest.runEpisodeTest({
      name: "panic-and-err",
      app,
      episodes: [failedLoadEpisode, loaded],
      mocks: { loadUser: { policy: "from-log" } },
      expect: { slotsEqual: "from-log", noPanics: true, noErrors: true },
    });
    expect(result.diffAt).toBe("panics");
    expect(result.actual).toBe("ep_ok: kaboom");
  });

  it("reports a divergence with no panic and no dropped err at the slot", () => {
    const app = makeCounterApp();
    app.reducers[0]!.apply = (live) => ({ slots: { count: live.count as number }, emits: [] });
    const result = _stdlibTest.runEpisodeTest({
      name: "divergence-only",
      app,
      episodes: [incEpisode(1), incEpisode(2)],
      mocks: {},
      expect: { slotsEqual: "from-log", noPanics: true, noErrors: true },
    });
    expect(result.diffAt).toBe("slots.count");
    expect(result.leaf).toEqual({ expected: 2, actual: 0 });
  });

  it.each([
    ["`no-panics` is not set", {}],
    ["`no-panics` is false", { noPanics: false }],
  ])("leaves a panic unreported when %s", (_, flags) => {
    const diverging = _stdlibTest.runEpisodeTest({
      name: "panic-unasserted",
      app: makePanickingCounterApp(),
      episodes: [incEpisode(1)],
      mocks: {},
      expect: { slotsEqual: { count: 1 }, ...flags },
    });
    expect(diverging.diffAt).toBe("slots.count");
    expect(diverging.leaf).toEqual({ expected: 1, actual: 0 });
    const matching = _stdlibTest.runEpisodeTest({
      name: "panic-unasserted",
      app: makePanickingCounterApp(),
      episodes: [incEpisode(1)],
      mocks: {},
      expect: { slotsEqual: { count: 0 }, ...flags },
    });
    expect(matching).toEqual({ name: "panic-unasserted", pass: true });
  });

  it("leaves a dropped err unreported when `no-errors` is not set", () => {
    const result = _stdlibTest.runEpisodeTest({
      name: "err-unasserted",
      app: makeDroppingLoadUserApp(),
      episodes: [failedLoadEpisode],
      mocks: { loadUser: { policy: "from-log" } },
      expect: { slotsEqual: "from-log", noPanics: true },
    });
    expect(result.diffAt).toBe("slots.error");
    expect(result.leaf).toEqual({ expected: "offline", actual: null });
  });
});
