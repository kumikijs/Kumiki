import type { AppShape, EmitSpec, EpisodeLogger, MountedApp, ReducerSpec } from "@kumikijs/runtime";
import { createEpisodeLogger } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp, keylessEffect } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { mountLogged, SINK_DOWN, throwingLogger } from "./helpers/episode-apps.ts";

// What `save`'s key throws for each argument: one instance apiece, so a test can tell the throw
// itself from a copy of it.
const NO_KEY = {
  note: new Error("no key for note"),
  draft: new Error("no key for draft"),
  a: new Error("no key for a"),
  b: new Error("no key for b"),
  batch: new AggregateError([new Error("x"), new Error("y")], "the host's batch failed"),
};
const saveOf = (what: keyof typeof NO_KEY): EmitSpec => ({ effect: "save", args: [what] });
const AUDIT: EmitSpec = { effect: "audit", args: ["fresh"] };
const plainLogger = (): EpisodeLogger => createEpisodeLogger();

type Trigger = "click" | "result";

type Probe = { audits: unknown[]; appErrors: unknown[] };

type RunOptions = {
  /** The episode logger to mount under, built once the app exists. */
  logger?: (app: AppShape) => EpisodeLogger;
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
      save: keylessEffect("save", (what) => NO_KEY[what as keyof typeof NO_KEY]),
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
  { logger = plainLogger, onErrorEmits = [] }: RunOptions = {},
): Promise<Run> {
  const { app, probe } = commitApp(trigger, emits, onErrorEmits);
  const { root, dispatch, dispose } = mountLogged(app, logger(app));
  onTestFinished(dispose);
  await vi.advanceTimersByTimeAsync(25);
  let thrown: unknown;
  try {
    dispatch(trigger === "click" ? "commit" : "start", {});
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

const messageOf = (e: unknown): unknown => (e as { message?: unknown }).message;

/** Each throw a click was handed: those an `AggregateError` holds, or the one throw. */
const eachThrow = (thrown: unknown): unknown[] =>
  thrown instanceof AggregateError ? thrown.errors : [thrown];

type Source = [what: string, emits: EmitSpec[], logger: () => EpisodeLogger, messages: string[]];

// What throws after `commit`'s batch commits, and the message of each throw, in order.
const SOURCES: Source[] = [
  ["one emit", [saveOf("note"), AUDIT], plainLogger, [NO_KEY.note.message]],
  [
    "two emits",
    [saveOf("note"), saveOf("draft"), AUDIT],
    plainLogger,
    [NO_KEY.note.message, NO_KEY.draft.message],
  ],
  [
    "an emit and the logger recording its render",
    [saveOf("note"), AUDIT],
    () => throwingLogger("recordSignalUpdate", (dirty) => dirty.includes("note")),
    [NO_KEY.note.message, SINK_DOWN],
  ],
  [
    "the logger recording the reducer",
    [AUDIT],
    () => throwingLogger("recordReducer", (name) => name === "commit"),
    [SINK_DOWN],
  ],
];

let errors: string[];
beforeEach(() => {
  vi.useFakeTimers();
  errors = captureConsole("error");
  captureConsole("warn");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each<[string, Trigger]>([
  ["on a click", "click"],
  ["on an effect's result", "result"],
])("a reducer %s that throws after its batch commits", (_, trigger) => {
  it.each(
    SOURCES,
  )("still dispatches its emits, stops its timers and renders, when %s throws", async (_, emits, logger) => {
    const { app, probe, root } = await runCommit(trigger, emits, { logger });
    expect(probe.audits).toEqual(["fresh"]);
    expect(app.live?.note).toBe("fresh");
    expect(root.textContent).toBe("note=fresh");
    const [before, after] = await beatsAcross(app);
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(before);
  });
});

describe("what a reducer on a click threw after its batch committed", () => {
  it.each(SOURCES)("goes on to the click, when %s throws", async (_, emits, logger, messages) => {
    const { thrown, probe } = await runCommit("click", emits, { logger });
    expect(eachThrow(thrown).map(messageOf)).toEqual(messages);
    expect(probe.appErrors).toEqual([]);
  });

  it("is the one throw itself, when one step threw", async () => {
    const { thrown } = await runCommit("click", [saveOf("note"), AUDIT]);
    expect(thrown).toBe(NO_KEY.note);
  });

  it("is one AggregateError whose message names each throw, when several steps threw", async () => {
    const { thrown } = await runCommit("click", [saveOf("note"), saveOf("draft"), AUDIT]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(messageOf(thrown)).toBe(
      '2 steps after reducer "commit" threw: no key for note; no key for draft',
    );
  });

  it("is an AggregateError the app's own code threw, as itself", async () => {
    const { thrown } = await runCommit("click", [saveOf("batch"), AUDIT]);
    expect(thrown).toBe(NO_KEY.batch);
  });

  it("holds what the logger closing its episode threw, after the steps' throws", async () => {
    const { thrown } = await runCommit("click", [saveOf("note"), AUDIT], {
      logger: (app) => throwingLogger("endTrigger", () => app.live?.note === "fresh"),
    });
    expect(eachThrow(thrown).map(messageOf)).toEqual([NO_KEY.note.message, SINK_DOWN]);
  });
});

describe("what a reducer on an effect's result threw after its batch committed", () => {
  it.each(
    SOURCES,
  )("is reported once per throw under category effect, when %s throws", async (_, emits, logger, messages) => {
    const { thrown, probe } = await runCommit("result", emits, { logger });
    expect(thrown).toBeUndefined();
    expect(probe.appErrors).toEqual(
      messages.map((message) =>
        expect.objectContaining({ message, location: 'effect "load"', category: "effect" }),
      ),
    );
    expect(errors.filter((line) => line.includes('effect "load"'))).toHaveLength(messages.length);
  });

  it("reports an AggregateError the app's own code threw as one throw", async () => {
    const { probe } = await runCommit("result", [saveOf("batch"), AUDIT]);
    expect(probe.appErrors.map(messageOf)).toEqual([NO_KEY.batch.message]);
  });

  it("reports each throw past an app.error reducer as its own, when several of its emits throw", async () => {
    const { probe } = await runCommit("result", [saveOf("note")], {
      onErrorEmits: [saveOf("a"), saveOf("b")],
    });
    expect(probe.appErrors).toHaveLength(1);
    expect(errors.filter((line) => line.includes('reducer "onError"'))).toEqual([
      expect.stringContaining(NO_KEY.a.message),
      expect.stringContaining(NO_KEY.b.message),
    ]);
  });
});
