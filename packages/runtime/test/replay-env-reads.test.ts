// Regression (#337): an episode is the record of one run, and a replay of it
// has to be that run again. A reducer that reads the environment — `random()`,
// `now`, `<T>.fresh()`, `prefers-dark()` — draws a value no slot can derive, so
// re-executing the body draws a NEW one and the replayed `slot-diffs` disagree
// with the recorded ones. The episode therefore carries `env-reads`: what each
// read answered, in the order the body asked, and the replay hands those back
// instead of re-reading (spec/runtime.md §10.5.1 + §10.5.3).

import type {
  AppShape,
  EnvScopeOutcome,
  EnvScopeReport,
  EpisodeLogEntry,
  EpisodeStep,
} from "@kumikijs/runtime";
import {
  _stdlibCore,
  createEpisodeLogger,
  KumikiPanic,
  mount,
  renderToString,
  replayEpisodes,
  withEnvRecord,
  withEnvReplay,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

type ReplayableApp = AppShape & { live: Record<string, unknown> };

/**
 * The shape codegen emits for `roll := (random() * 6.0).floor + 1` and
 * `stamped := now.show` — the stdlib call is inside `apply`, which is exactly
 * where the recorder has to reach.
 */
function makeDiceApp(): ReplayableApp {
  const slots = {
    roll: { value: 0 },
    stamped: { value: "" },
    id: { value: "" },
  };
  const app: ReplayableApp = {
    live: {},
    slots,
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "roll6",
        event: { kind: "ui", ev: "click" },
        apply: () => ({
          slots: {
            roll: Math.floor(_stdlibCore.random() * 6) + 1,
            stamped: _stdlibCore.show(_stdlibCore.now()),
            id: _stdlibCore.freshId(),
          },
          emits: [],
        }),
      },
    ],
    root: () => ({ kind: "text", text: "" }),
  };
  for (const [k, m] of Object.entries(slots)) app.live[k] = m.value;
  return app;
}

/** Drive one click through the live runtime and return the episode it wrote. */
function recordOneRoll(): EpisodeLogEntry {
  const app = makeDiceApp();
  const logger = createEpisodeLogger({ memoryMax: 10 });
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const { dispose } = mount(app, root, { episodeLogger: logger });
    const dispatch = (
      app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
    )._dispatch;
    dispatch("roll6", {});
    dispose();
    const eps = logger.list();
    expect(eps).toHaveLength(1);
    // Round-trip through JSON: an episode reaches replay as a log line, and a
    // field that does not survive serialization is not a recording.
    return JSON.parse(JSON.stringify(eps[0])) as EpisodeLogEntry;
  } finally {
    root.remove();
  }
}

function reducerStep(ep: EpisodeLogEntry): Extract<EpisodeStep, { kind: "reducer" }> {
  const step = ep.steps.find((s) => s.kind === "reducer");
  if (!step) throw new Error("episode has no reducer step");
  return step as Extract<EpisodeStep, { kind: "reducer" }>;
}

function afterOf(ep: EpisodeLogEntry, slot: string): unknown {
  const diffs = reducerStep(ep)["slot-diffs"] ?? [];
  return diffs.find((d) => d.name === slot)?.after;
}

function replayOnce(ep: EpisodeLogEntry): Record<string, unknown> {
  const app = makeDiceApp();
  return replayEpisodes({
    app: { live: app.live, slots: app.slots, reducers: app.reducers },
    episodes: [ep],
    mocks: {},
    observer: () => "continue",
  }).finalSlots;
}

/**
 * The value half of a scope outcome. A body that threw where the test did not
 * expect one should surface as that throw, not as a property that is missing.
 */
function ok<T>(out: EnvScopeOutcome<T>): { value: T; env: EnvScopeReport } {
  if (!out.ok) throw out.error;
  return out;
}

describe("environment reads in an episode (#337, §10.5.1)", () => {
  it("records what each read returned, in the order the reducer asked", () => {
    const ep = recordOneRoll();
    const reads = reducerStep(ep)["env-reads"] ?? [];
    expect(reads.map((r) => r.kind)).toEqual(["random", "now", "fresh-id"]);
    expect(typeof reads[0]?.value).toBe("number");
    expect(reads[0]?.value as number).toBeGreaterThanOrEqual(0);
    expect(reads[0]?.value as number).toBeLessThan(1);
    // The recorded read is the one the recorded diff was derived from.
    expect(afterOf(ep, "roll")).toBe(Math.floor((reads[0]?.value as number) * 6) + 1);
    expect(afterOf(ep, "stamped")).toBe(String(reads[1]?.value));
    expect(afterOf(ep, "id")).toBe(reads[2]?.value);
  });

  it("replaying an episode that read the environment reproduces its slot-diffs, every time", () => {
    const ep = recordOneRoll();
    const expected = {
      roll: afterOf(ep, "roll"),
      stamped: afterOf(ep, "stamped"),
      id: afterOf(ep, "id"),
    };
    for (let i = 0; i < 5; i++) {
      const slots = replayOnce(ep);
      expect({ roll: slots.roll, stamped: slots.stamped, id: slots.id }).toEqual(expected);
    }
  });

  it("a log written before env-reads existed still replays", () => {
    const ep = recordOneRoll();
    const legacy = JSON.parse(JSON.stringify(ep)) as EpisodeLogEntry;
    for (const s of legacy.steps) {
      if (s.kind === "reducer") delete (s as { "env-reads"?: unknown })["env-reads"];
    }
    const slots = replayOnce(legacy);
    // Nothing to hand back, so the reducer reads live again — the old
    // behaviour, which stays a working replay rather than a throw.
    expect(slots.roll as number).toBeGreaterThanOrEqual(1);
    expect(slots.roll as number).toBeLessThanOrEqual(6);
    expect(typeof slots.stamped).toBe("string");
  });
});

describe("the environment journal", () => {
  it("passes reads straight through when no scope is open", () => {
    const a = _stdlibCore.now();
    const b = _stdlibCore.random();
    expect(typeof a).toBe("number");
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(1);
  });

  it("hands a replay the recorded value, and falls back to live once they run out", () => {
    const recorded = ok(withEnvRecord(() => _stdlibCore.random()));
    const drawn = recorded.value;
    expect(recorded.env.reads).toEqual([{ kind: "random", value: drawn }]);

    const replayed = ok(
      withEnvReplay(recorded.env.reads, () => {
        const first = _stdlibCore.random();
        // Second draw has no recorded answer left. Asserting it is a number
        // would also pass if the spent entry were served again, which is the
        // case this is here to exclude.
        const second = _stdlibCore.random();
        return { first, second };
      }),
    );
    expect(replayed.value.first).toBe(drawn);
    expect(replayed.value.second).not.toBe(drawn);
    expect(replayed.env.live).toBe(1);
    expect(replayed.env.unused).toBe(0);
  });

  it("matches a recorded read to the same kind, so an extra read of one kind cannot shift another", () => {
    const out = ok(
      withEnvReplay(
        [
          { kind: "now", value: 1718700000000 },
          { kind: "random", value: 0.5 },
        ],
        // Asking in the opposite order still gets each kind its own recorded value.
        () => ({ random: _stdlibCore.random(), now: _stdlibCore.now() }),
      ),
    );
    expect(out.value).toEqual({ random: 0.5, now: 1718700000000 });
    expect(out.env).toEqual({ reads: [], live: 0, unused: 0, malformed: 0 });
  });

  it("reports the recorded answers the replayed body never asked for", () => {
    const out = ok(
      withEnvReplay(
        [
          { kind: "now", value: 1 },
          { kind: "now", value: 2 },
          { kind: "prefers-dark", value: true },
        ],
        () => _stdlibCore.now(),
      ),
    );
    expect(out.value).toBe(1);
    expect(out.env.unused).toBe(2);
    expect(out.env.live).toBe(0);
  });

  it("leaves the environment live again once the scope closes", () => {
    // Two identical entries, so the assertion after the scope fails if
    // `endEnvScope` were a no-op — one entry would already be spent by the
    // read inside, and the check outside would pass either way.
    const out = ok(
      withEnvReplay(
        [
          { kind: "now", value: 42 },
          { kind: "now", value: 42 },
        ],
        () => _stdlibCore.now(),
      ),
    );
    expect(out.value).toBe(42);
    expect(out.env.unused).toBe(1);
    expect(_stdlibCore.now()).not.toBe(42);
  });

  it("closes the scope when the body throws, so a later read is not captured", () => {
    const out = withEnvRecord(() => {
      _stdlibCore.random();
      throw new Error("boom");
    });
    expect(out.ok).toBe(false);
    // The reads the body got to before it threw are still reported — that is
    // what makes a recorded crash reproducible.
    expect(out.env.reads.map((r) => r.kind)).toEqual(["random"]);
    // And the frame is gone: a read now is live, not journalled into a leak.
    const after = ok(withEnvRecord(() => _stdlibCore.now()));
    expect(after.env.reads).toHaveLength(1);
  });

  it("journals prefers-dark like the other three", () => {
    const recorded = ok(withEnvRecord(() => _stdlibCore.prefersDark()));
    expect(recorded.env.reads.map((r) => r.kind)).toEqual(["prefers-dark"]);
    // happy-dom answers `false`; the recorded run is replayed as recorded
    // whichever way the host would answer now.
    const replayed = ok(
      withEnvReplay([{ kind: "prefers-dark", value: true }], () => _stdlibCore.prefersDark()),
    );
    expect(replayed.value).toBe(true);
    expect(replayed.env.live).toBe(0);
  });
});

describe("a malformed env-reads list (#337)", () => {
  it("rejects an entry with no usable value instead of handing the body undefined", () => {
    const out = ok(
      withEnvReplay([{ kind: "now" }, { kind: "random", value: "half" }], () => ({
        now: _stdlibCore.now(),
        random: _stdlibCore.random(),
      })),
    );
    // A `--from-log` file is user input. Consuming `{kind: "now"}` would make
    // `now.show` render "undefined" and the arithmetic go NaN, with nothing
    // throwing to say why.
    expect(out.env.malformed).toBe(2);
    expect(out.env.live).toBe(2);
    expect(typeof out.value.now).toBe("number");
    expect(Number.isNaN(out.value.now)).toBe(false);
    expect(out.value.random).toBeGreaterThanOrEqual(0);
  });

  it("survives an env-reads that is not a list at all", () => {
    const out = ok(withEnvReplay("not a list", () => _stdlibCore.now()));
    expect(out.env.malformed).toBe(1);
    expect(out.env.live).toBe(1);
    expect(typeof out.value).toBe("number");
  });
});

describe("a reducer that panicked (#337)", () => {
  /** The shape codegen emits for a reducer whose body reads, then panics. */
  function makePanicApp(): ReplayableApp {
    const slots = { roll: { value: 0 } };
    const app: ReplayableApp = {
      live: {},
      slots,
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "risky",
          event: { kind: "ui", ev: "click" },
          apply: () => {
            const drawn = _stdlibCore.random();
            if (drawn < 0.5) throw new KumikiPanic(`unlucky: ${drawn}`, 'reducer "risky"');
            return { slots: { roll: drawn }, emits: [] };
          },
        },
      ],
      root: () => ({ kind: "text", text: "" }),
    };
    for (const [k, m] of Object.entries(slots)) app.live[k] = m.value;
    return app;
  }

  /** Dispatch until the reducer panics, and return that episode. */
  function recordAPanic(): EpisodeLogEntry {
    for (let attempt = 0; attempt < 200; attempt++) {
      const app = makePanicApp();
      const logger = createEpisodeLogger({ memoryMax: 10 });
      const root = document.createElement("div");
      document.body.appendChild(root);
      try {
        const { dispose } = mount(app, root, { episodeLogger: logger });
        (
          app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void }
        )._dispatch("risky", {});
        dispose();
        const ep = logger.list()[0];
        if (ep?.status === "panic") return JSON.parse(JSON.stringify(ep)) as EpisodeLogEntry;
      } finally {
        root.remove();
      }
    }
    throw new Error("no panic in 200 dispatches — the fixture is not random");
  }

  it("records the reducer's name and its reads on the panic step", () => {
    const ep = recordAPanic();
    const step = ep.steps.find((s) => s.kind === "panic") as
      | Extract<EpisodeStep, { kind: "panic" }>
      | undefined;
    expect(step?.name).toBe("risky");
    expect(step?.["env-reads"]?.map((r) => r.kind)).toEqual(["random"]);
    expect(step?.message).toBe(`unlucky: ${step?.["env-reads"]?.[0]?.value}`);
  });

  it("replays the crash — the episode a bug report carries is the one that crashed", () => {
    const ep = recordAPanic();
    const recorded = ep.steps.find((s) => s.kind === "panic") as
      | Extract<EpisodeStep, { kind: "panic" }>
      | undefined;
    for (let i = 0; i < 5; i++) {
      const app = makePanicApp();
      const report = replayEpisodes({
        app: { live: app.live, slots: app.slots, reducers: app.reducers },
        episodes: [ep],
        mocks: {},
        observer: () => "continue",
      });
      // Without the panic step's `env-reads` this re-rolls and passes ~50% of
      // the time — and `kumiki replay` would exit 0 on a recorded crash.
      expect(report.panics.map((p) => p.message)).toEqual([recorded?.message]);
      expect(report.envDrift.live).toBe(0);
    }
  });
});

describe("the other two recording paths (#337)", () => {
  it("the SSR bootstrap episode journals its reducers' reads", async () => {
    // §10.5.1.1: the bootstrap episode is an episode, so a replay of the SSR
    // chain has to reproduce the instants the server stamped. Dropping the
    // 4th argument at `ssr.ts`'s two `recordReducer` calls is invisible to a
    // suite that only asserts step kinds.
    const app: AppShape = {
      slots: { seededAt: { value: "" }, token: { value: "" } },
      caps: ["http.get"],
      effects: {
        boot: {
          name: "boot",
          cap: "http.get",
          invoke: async () => ({ kind: "ok", value: null }),
        },
      },
      init: [{ effect: "boot", args: [] }],
      reducers: [
        {
          name: "booted",
          event: { kind: "effect", effect: "boot", outcome: "ok" },
          apply: () => ({
            slots: {
              seededAt: _stdlibCore.show(_stdlibCore.now()),
              token: _stdlibCore.freshId(),
            },
            emits: [],
          }),
        },
      ],
      root: () => ({ kind: "text", text: "" }),
    };
    const rendered = await renderToString(app, {
      providers: { "http.get": async () => ({ kind: "ok", value: null }) },
    });
    const step = rendered.snapshot.bootstrap.steps.find((s) => s.kind === "reducer") as
      | Extract<EpisodeStep, { kind: "reducer" }>
      | undefined;
    expect(step?.name).toBe("booted");
    const reads = step?.["env-reads"] ?? [];
    expect(reads.map((r) => r.kind)).toEqual(["now", "fresh-id"]);
    // The recorded diffs are what those reads produced — the property that
    // makes replaying the bootstrap chain reproduce the server's run.
    const after = Object.fromEntries((step?.["slot-diffs"] ?? []).map((d) => [d.name, d.after]));
    expect(after.seededAt).toBe(String(reads[0]?.value));
    expect(after.token).toBe(reads[1]?.value);
  });

  it("a reducer whose batch a refinement rejected still records what it read", () => {
    // Its `slot-diffs` is `[]`, so the "replays to the recorded slot-diffs"
    // assertions elsewhere are vacuously true here. The reads matter anyway:
    // a replay that re-runs the body has to see them or it may not reject.
    const app: AppShape = {
      slots: { roll: { value: 1, refine: (v) => (v as number) > 0.5 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "reroll",
          event: { kind: "ui", ev: "click" },
          apply: () => ({ slots: { roll: _stdlibCore.random() * 0.4 }, emits: [] }),
        },
      ],
      root: () => ({ kind: "text", text: "" }),
    };
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const root = document.createElement("div");
    document.body.appendChild(root);
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      (app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void })._dispatch(
        "reroll",
        {},
      );
      dispose();
      const ep = logger.list()[0];
      const step = ep?.steps.find((s) => s.kind === "reducer") as
        | Extract<EpisodeStep, { kind: "reducer" }>
        | undefined;
      expect(step?.["slot-diffs"]).toEqual([]);
      expect(step?.["env-reads"]?.map((r) => r.kind)).toEqual(["random"]);
    } finally {
      root.remove();
    }
  });
});
