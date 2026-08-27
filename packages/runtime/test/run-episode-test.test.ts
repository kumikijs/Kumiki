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
