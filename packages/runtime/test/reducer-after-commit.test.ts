import type { AppShape, EmitSpec, EpisodeLogger, MountedApp, ReducerSpec } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

// `save`'s key is read by the dispatcher when it takes the emit, after the reducer body that
// emitted it has returned, so its dispatch throws past that body.
const saveOf = (what: string): EmitSpec => ({ effect: "save", args: [what] });
const noKeyFor = (what: string): string => `no key for ${what}`;
const AUDIT: EmitSpec = { effect: "audit", args: ["fresh"] };
const SINK_DOWN = "episode sink offline";

type Trigger = "click" | "result";

type Probe = { audits: unknown[]; appErrors: unknown[] };

type RunOptions = {
  logger?: EpisodeLogger;
  /** What the `app.error` reducer emits. */
  onErrorEmits?: EmitSpec[];
};

/**
 * `commit` writes `note`, emits `emits` and stops the `beat` timer, which counts in `beats`. It
 * runs on a click, or on `load`'s `.ok`, which a click on `start` launches.
 */
function commitApp(
  trigger: Trigger,
  emits: EmitSpec[],
  onErrorEmits: EmitSpec[] = [],
): { app: AppShape; probe: Probe } {
  const probe: Probe = { audits: [], appErrors: [] };
  const commit: ReducerSpec = {
    name: "commit",
    event:
      trigger === "click"
        ? { kind: "ui", ev: "click" }
        : { kind: "effect", effect: "load", outcome: "ok" },
    apply: () => ({ slots: { note: "fresh" }, emits, stopTimers: ["beat"] }),
  };
  const app: AppShape = bareApp({
    slots: { note: { value: "stale" }, beats: { value: 0 } },
    effects: {
      load: { name: "load", cap: "", invoke: async () => ({ kind: "ok", value: null }) },
      save: {
        name: "save",
        cap: "",
        policy: {
          kind: "latest-per-key",
          keyOf: (what) => {
            throw new Error(noKeyFor(String(what)));
          },
        },
        invoke: async () => ({ kind: "ok", value: null }),
      },
      audit: {
        name: "audit",
        cap: "",
        invoke: async (input) => {
          probe.audits.push(input);
          return { kind: "ok", value: null };
        },
      },
    },
    reducers: [
      {
        name: "start",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "load", args: [null] }] }),
      },
      commit,
      {
        name: "beat",
        event: { kind: "timer", intervalMs: 10, name: "beat" },
        apply: (live) => ({ slots: { beats: (live.beats as number) + 1 }, emits: [] }),
      },
      {
        name: "onError",
        event: { kind: "lifecycle", name: "app.error" },
        apply: (_live, payload) => {
          probe.appErrors.push(payload.$event);
          return { slots: {}, emits: onErrorEmits };
        },
      },
    ],
    root: () => ({ kind: "text", text: `note=${String((app as MountedApp).live?.note)}` }),
  });
  return { app, probe };
}

type Run = { app: AppShape; probe: Probe; root: HTMLElement; thrown: unknown };

/**
 * Mount `commitApp` under `opts.logger`, let `beat` fire, run `commit` and let its result settle.
 * `thrown` is what the click that ran it threw.
 */
async function runCommit(
  trigger: Trigger,
  emits: EmitSpec[],
  { logger = createEpisodeLogger(), onErrorEmits = [] }: RunOptions = {},
): Promise<Run> {
  const { app, probe } = commitApp(trigger, emits, onErrorEmits);
  const root = freshRoot();
  const handle = mount(app, root, { episodeLogger: logger });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  await vi.advanceTimersByTimeAsync(25);
  let thrown: unknown;
  try {
    (app as MountedApp)._dispatch(trigger === "click" ? "commit" : "start", {});
  } catch (e) {
    thrown = e;
  }
  await vi.advanceTimersByTimeAsync(0);
  return { app, probe, root, thrown };
}

/** `beats` now, and again once `beat` would have fired a few more times. */
async function beatsAcross(app: AppShape): Promise<[unknown, unknown]> {
  const before = app.live?.beats;
  await vi.advanceTimersByTimeAsync(50);
  return [before, app.live?.beats];
}

/** An episode logger that throws while it records a render in which `note` changed. */
function throwingOnNoteRender(): EpisodeLogger {
  const logger = createEpisodeLogger();
  return {
    ...logger,
    recordSignalUpdate(dirty, binds) {
      logger.recordSignalUpdate(dirty, binds);
      if (dirty.includes("note")) throw new Error(SINK_DOWN);
    },
  };
}

/** An episode logger that throws while it records `commit`'s reducer step. */
function throwingOnCommit(): EpisodeLogger {
  const logger = createEpisodeLogger();
  return {
    ...logger,
    recordReducer(name, diffs, emits, envReads) {
      logger.recordReducer(name, diffs, emits, envReads);
      if (name === "commit") throw new Error(SINK_DOWN);
    },
  };
}

const messageOf = (e: unknown): unknown => (e as { message?: unknown }).message;

let errors: string[];
beforeEach(() => {
  vi.useFakeTimers();
  errors = captureConsole("error");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each<[string, Trigger]>([
  ["on a click", "click"],
  ["on an effect's result", "result"],
])("a reducer %s whose emit's dispatch throws after its batch commits", (_, trigger) => {
  const emits = [saveOf("note"), AUDIT];

  it("still dispatches the emits after it", async () => {
    const { probe } = await runCommit(trigger, emits);
    expect(probe.audits).toEqual(["fresh"]);
  });

  it("still stops its timers", async () => {
    const { app } = await runCommit(trigger, emits);
    const [before, after] = await beatsAcross(app);
    expect(after).toBe(before);
  });

  it("still renders what it wrote", async () => {
    const { app, root } = await runCommit(trigger, emits);
    expect(app.live?.note).toBe("fresh");
    expect(root.textContent).toBe("note=fresh");
  });
});

describe("what a reducer's emit threw after its batch committed", () => {
  it("goes on to the click that ran it, as itself", async () => {
    const { thrown, probe } = await runCommit("click", [saveOf("note"), AUDIT]);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(AggregateError);
    expect(messageOf(thrown)).toBe(noKeyFor("note"));
    expect(probe.appErrors).toEqual([]);
  });

  it("is reported once under category effect, on an effect's result", async () => {
    const { thrown, probe } = await runCommit("result", [saveOf("note"), AUDIT]);
    expect(thrown).toBeUndefined();
    expect(probe.appErrors).toEqual([
      expect.objectContaining({
        message: noKeyFor("note"),
        location: 'effect "load"',
        category: "effect",
      }),
    ]);
    expect(errors.filter((line) => line.includes('effect "load"'))).toHaveLength(1);
  });

  it("goes on to the click as one AggregateError holding each, when several emits throw", async () => {
    const { thrown, probe } = await runCommit("click", [saveOf("note"), saveOf("draft"), AUDIT]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map(messageOf)).toEqual([
      noKeyFor("note"),
      noKeyFor("draft"),
    ]);
    expect(probe.audits).toEqual(["fresh"]);
  });

  it("is reported once per throw on an effect's result, when several emits throw", async () => {
    const { probe } = await runCommit("result", [saveOf("note"), saveOf("draft"), AUDIT]);
    expect(probe.appErrors).toEqual([
      expect.objectContaining({ message: noKeyFor("note"), category: "effect" }),
      expect.objectContaining({ message: noKeyFor("draft"), category: "effect" }),
    ]);
    expect(probe.audits).toEqual(["fresh"]);
  });

  it("is reported once per throw on an effect's result, when an emit and the logger both throw", async () => {
    captureConsole("warn");
    const { probe } = await runCommit("result", [saveOf("note")], {
      logger: throwingOnNoteRender(),
    });
    expect(probe.appErrors.map(messageOf)).toEqual([noKeyFor("note"), SINK_DOWN]);
  });

  it("is reported once per throw on an app.error reducer, when several of its emits throw", async () => {
    const { probe } = await runCommit("result", [saveOf("note")], {
      onErrorEmits: [saveOf("a"), saveOf("b")],
    });
    expect(probe.appErrors).toHaveLength(1);
    expect(errors.filter((line) => line.includes('reducer "onError"'))).toEqual([
      expect.stringContaining(noKeyFor("a")),
      expect.stringContaining(noKeyFor("b")),
    ]);
  });
});

describe("a reducer whose step the episode logger throws on after its batch commits", () => {
  it.each<[string, Trigger]>([
    ["a click", "click"],
    ["an effect's result", "result"],
  ])("still dispatches its emits, stops its timers and renders, on %s", async (_, trigger) => {
    captureConsole("warn");
    const { app, probe, root, thrown } = await runCommit(trigger, [AUDIT], {
      logger: throwingOnCommit(),
    });
    expect(probe.audits).toEqual(["fresh"]);
    expect(root.textContent).toBe("note=fresh");
    const [before, after] = await beatsAcross(app);
    expect(after).toBe(before);
    expect(trigger === "click" ? messageOf(thrown) : messageOf(probe.appErrors[0])).toBe(SINK_DOWN);
  });
});
