// Regression (#337): an episode is the record of one run, and a replay of it
// has to be that run again. A reducer that reads the environment — `random()`,
// `now`, `<T>.fresh()`, `prefers-dark()` — draws a value no slot can derive, so
// re-executing the body draws a NEW one and the replayed `slot-diffs` disagree
// with the recorded ones. The episode therefore carries `env-reads`: what each
// read answered, in the order the body asked, and the replay hands those back
// instead of re-reading (spec/runtime.md §10.5.1 + §10.5.3).

import type { AppShape, EpisodeLogEntry, EpisodeStep } from "@kumikijs/runtime";
import {
  _stdlibCore,
  beginEnvRecord,
  beginEnvReplay,
  createEpisodeLogger,
  endEnvScope,
  mount,
  replayEpisodes,
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
    beginEnvRecord();
    const drawn = _stdlibCore.random();
    const reads = endEnvScope();
    expect(reads).toEqual([{ kind: "random", value: drawn }]);

    beginEnvReplay(reads);
    expect(_stdlibCore.random()).toBe(drawn);
    // Second draw has no recorded answer left — live, not a throw or a repeat.
    const extra = _stdlibCore.random();
    expect(typeof extra).toBe("number");
    endEnvScope();
  });

  it("matches a recorded read to the same kind, so an extra read of one kind cannot shift another", () => {
    beginEnvReplay([
      { kind: "now", value: 1718700000000 },
      { kind: "random", value: 0.5 },
    ]);
    // Asking in the opposite order still gets each kind its own recorded value.
    expect(_stdlibCore.random()).toBe(0.5);
    expect(_stdlibCore.now()).toBe(1718700000000);
    expect(endEnvScope()).toEqual([]);
  });

  it("leaves the environment live again once the scope closes", () => {
    beginEnvReplay([{ kind: "now", value: 42 }]);
    expect(_stdlibCore.now()).toBe(42);
    endEnvScope();
    expect(_stdlibCore.now()).not.toBe(42);
  });
});
