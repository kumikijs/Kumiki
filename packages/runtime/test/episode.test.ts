import { createEpisodeLogger, type Episode, type EpisodeLogger } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { memoryStorage } from "./helpers/episode-apps.ts";

function makeLogger(opts: Partial<Parameters<typeof createEpisodeLogger>[0]> = {}): {
  logger: EpisodeLogger;
  tick: () => void;
} {
  let t = 1000;
  const tick = () => {
    t += 1;
  };
  let seq = 0;
  const logger = createEpisodeLogger({
    now: () => t,
    idGen: () => {
      const n = seq++;
      return `ep_${n.toString().padStart(4, "0")}`;
    },
    ...opts,
  });
  return { logger, tick };
}

describe("EpisodeLogger", () => {
  it("records a sync reducer → effect-start → effect-end → signal-update episode", () => {
    const { logger, tick } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "AddBtn" });
    tick();
    logger.recordReducer("addItem", [{ name: "items", before: [], after: ["a"] }], ["persist"]);
    tick();
    const tok = logger.recordEffectStart("persist", { value: ["a"] });
    tick();
    const exit = logger.recordEffectEnd(tok, "persist", "ok", null);
    exit();
    tick();
    logger.recordSignalUpdate(["items"]);
    logger.endTrigger();

    const eps = logger.list();
    expect(eps).toHaveLength(1);
    const ep = eps[0]!;
    expect(ep.id).toBe("ep_0000");
    expect(ep.trigger.kind).toBe("ui.click");
    expect(ep.trigger.target).toBe("AddBtn");
    expect(ep.status).toBe("completed");
    expect(ep.steps.map((s) => s.kind)).toEqual([
      "reducer",
      "effect-start",
      "effect-end",
      "signal-update",
    ]);
    expect(ep.steps[0]).toMatchObject({
      kind: "reducer",
      name: "addItem",
      emits: ["persist"],
      "slot-diffs": [{ name: "items", before: [], after: ["a"] }],
    });
    expect(ep.steps[3]).toHaveProperty("dirty-slots", ["items"]);
  });

  it("flips status to panic when recordPanic is called and finalizes", () => {
    const { logger } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "OopsBtn" });
    logger.recordPanic({ message: "boom", location: `reducer "oops"` });
    logger.endTrigger();

    const eps = logger.list();
    expect(eps).toHaveLength(1);
    expect(eps[0]!.status).toBe("panic");
    expect(eps[0]!.steps[0]).toMatchObject({
      kind: "panic",
      message: "boom",
      location: `reducer "oops"`,
    });
  });

  it("carries stack / cause / category from recordPanic into the step", () => {
    const { logger } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "OopsBtn" });
    logger.recordPanic({
      message: "boom",
      location: `reducer "oops"`,
      stack: "Error: boom\n    at oops (src/x.ts:1:1)",
      cause: [{ message: "root", stack: "Error: root\n    at inner (src/y.ts:2:2)" }],
      category: "reducer",
    });
    logger.endTrigger();

    const step = logger.list()[0]!.steps[0]!;
    expect(step).toMatchObject({
      kind: "panic",
      message: "boom",
      location: `reducer "oops"`,
      stack: expect.stringContaining("at oops"),
      category: "reducer",
    });
    expect((step as { cause?: unknown[] }).cause).toHaveLength(1);
    expect((step as { cause: { message: string; stack?: string }[] }).cause[0]).toMatchObject({
      message: "root",
      stack: expect.stringContaining("at inner"),
    });
  });

  it("omits empty cause / undefined stack fields on the step (forward-compat)", () => {
    const { logger } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "OopsBtn" });
    logger.recordPanic({ message: "boom", cause: [], category: "unknown" });
    logger.endTrigger();

    const step = logger.list()[0]!.steps[0]!;
    expect(step).not.toHaveProperty("cause");
    expect(step).not.toHaveProperty("stack");
    expect(step).not.toHaveProperty("location");
    expect(step).toMatchObject({ kind: "panic", message: "boom", category: "unknown" });
  });

  it("ring-buffers the most recent N episodes (memoryMax)", () => {
    const { logger } = makeLogger({ memoryMax: 3 });
    for (let i = 0; i < 5; i++) {
      logger.beginTrigger({ kind: "lifecycle", target: `n${i}` });
      logger.endTrigger();
    }
    const eps = logger.list();
    expect(eps).toHaveLength(3);
    expect(eps.map((e) => e.trigger.target)).toEqual(["n2", "n3", "n4"]);
  });

  it("calls onEpisode for every committed episode", () => {
    const seen: string[] = [];
    const { logger } = makeLogger({ onEpisode: (ep) => seen.push(ep.id) });
    logger.beginTrigger({ kind: "lifecycle", target: "x" });
    logger.endTrigger();
    logger.beginTrigger({ kind: "lifecycle", target: "y" });
    logger.endTrigger();
    expect(seen).toEqual(["ep_0000", "ep_0001"]);
  });

  it("defers commit and attaches async effect-end + chain reducer to the original episode", () => {
    const { logger } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "AsyncBtn" });
    logger.recordReducer("kick", [], ["loadUser"]);
    const tok = logger.recordEffectStart("loadUser", null);
    logger.endTrigger();
    expect(logger.list()).toEqual([]);

    const exit = logger.recordEffectEnd(tok, "loadUser", "ok", { id: 42 });
    logger.recordReducer("setUser", [{ name: "user", before: null, after: { id: 42 } }], []);
    logger.recordSignalUpdate(["user"]);
    exit();

    const eps = logger.list();
    expect(eps).toHaveLength(1);
    expect(eps[0]!.status).toBe("completed");
    expect(eps[0]!.steps.map((s) => s.kind)).toEqual([
      "reducer",
      "effect-start",
      "effect-end",
      "reducer",
      "signal-update",
    ]);
  });

  it("step timestamps are monotonically non-decreasing", () => {
    const { logger, tick } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "X" });
    tick();
    logger.recordReducer("a", [], []);
    tick();
    logger.recordReducer("b", [], []);
    logger.endTrigger();
    const steps = logger.list()[0]!.steps;
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.ts).toBeGreaterThanOrEqual(steps[i - 1]!.ts);
    }
  });

  it("ignores record* calls when no episode is open (orphan dispatch)", () => {
    const { logger } = makeLogger();
    logger.recordReducer("orphan", [], []);
    logger.recordSignalUpdate(["x"]);
    expect(logger.list()).toEqual([]);
  });

  it("persists to localStorage when opted in (browser-only)", () => {
    const { impl: ls, backing: store } = memoryStorage();
    const { logger } = makeLogger({
      localStorage: true,
      localStorageMax: 2,
      localStorageKey: "kumiki.test.eps",
      localStorageImpl: ls,
    });
    for (let i = 0; i < 4; i++) {
      logger.beginTrigger({ kind: "lifecycle", target: `n${i}` });
      logger.endTrigger();
    }
    const raw = store.get("kumiki.test.eps");
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { trigger: { target: string } }[];
    expect(parsed.map((e) => e.trigger.target)).toEqual(["n2", "n3"]);
  });
});

describe("the order the logger keeps episodes in", () => {
  /** A logger, and the trigger targets one of its outlets holds, in the order it holds them. */
  type Outlet = { logger: EpisodeLogger; targets: () => (string | undefined)[] };

  // Each row: the outlet, what it holds while the first episode still waits on its effect, and how
  // to build it. `onEpisode` feeds append-only files, so it gets nothing ahead of an earlier
  // trigger; the two stores take a committed episode at once, at its trigger's place.
  const outlets: [string, string[], () => Outlet][] = [
    [
      "list()",
      ["BBtn"],
      () => {
        const { logger } = makeLogger();
        return { logger, targets: () => logger.list().map((ep) => ep.trigger.target) };
      },
    ],
    [
      "the localStorage mirror",
      ["BBtn"],
      () => {
        const { impl, backing } = memoryStorage();
        const { logger } = makeLogger({ localStorage: true, localStorageImpl: impl });
        const targets = () =>
          (JSON.parse(backing.get("kumiki.episodes") ?? "[]") as Episode[]).map(
            (ep) => ep.trigger.target,
          );
        return { logger, targets };
      },
    ],
    [
      "onEpisode",
      [],
      () => {
        const seen: (string | undefined)[] = [];
        const { logger } = makeLogger({ onEpisode: (ep) => seen.push(ep.trigger.target) });
        return { logger, targets: () => seen.slice() };
      },
    ],
  ];

  it.each(
    outlets,
  )("%s holds %j while the first episode waits on its effect, then both in trigger order", (_, whileWaiting, make) => {
    const { logger, targets } = make();
    logger.beginTrigger({ kind: "ui.click", target: "ABtn" });
    logger.recordReducer("pickA", [{ name: "x", before: "", after: "a" }], ["save"]);
    const save = logger.recordEffectStart("save", "a");
    logger.endTrigger();
    logger.beginTrigger({ kind: "ui.click", target: "BBtn" });
    logger.recordReducer("pickB", [{ name: "x", before: "a", after: "b" }], []);
    logger.endTrigger();
    expect(targets()).toEqual(whileWaiting);

    const exit = logger.recordEffectEnd(save, "save", "ok", null);
    logger.recordReducer("savedOk", [{ name: "saved", before: "", after: "b" }], []);
    exit();
    expect(targets()).toEqual(["ABtn", "BBtn"]);
  });

  it.each(
    outlets,
  )("%s gets an episode once it is done, while one begun after it waits", (_, _w, make) => {
    const { logger, targets } = make();
    logger.beginTrigger({ kind: "ui.click", target: "ABtn" });
    const save = logger.recordEffectStart("save", "a");
    logger.endTrigger();
    logger.recordEffectEnd(save, "save", "ok", null)();
    logger.beginTrigger({ kind: "ui.click", target: "BBtn" });
    logger.recordEffectStart("save", "b");
    logger.endTrigger();
    expect(targets()).toEqual(["ABtn"]);
  });
});
