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

  it("hands onEpisode each episode once it is done, in the order their triggers began", () => {
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
  type LoggerOpts = Partial<Parameters<typeof createEpisodeLogger>[0]>;
  /** A logger, and the trigger targets one of its outlets holds, in the order it holds them. */
  type Outlet = { logger: EpisodeLogger; targets: () => (string | undefined)[] };
  type MakeOutlet = (opts?: LoggerOpts) => Outlet;

  const listOutlet: MakeOutlet = (opts) => {
    const { logger } = makeLogger(opts);
    return { logger, targets: () => logger.list().map((ep) => ep.trigger.target) };
  };
  const mirrorOutlet: MakeOutlet = (opts) => {
    const { impl, backing } = memoryStorage();
    const { logger } = makeLogger({ ...opts, localStorage: true, localStorageImpl: impl });
    const targets = () =>
      (JSON.parse(backing.get("kumiki.episodes") ?? "[]") as Episode[]).map(
        (ep) => ep.trigger.target,
      );
    return { logger, targets };
  };
  const hookOutlet: MakeOutlet = (opts) => {
    const seen: (string | undefined)[] = [];
    const { logger } = makeLogger({ ...opts, onEpisode: (ep) => seen.push(ep.trigger.target) });
    return { logger, targets: () => seen.slice() };
  };

  /** Open an episode for `target` that is done at once. */
  const done = (logger: EpisodeLogger, target: string, ts?: number): void => {
    logger.beginTrigger({ kind: "ui.click", target, ...(ts !== undefined ? { ts } : {}) });
    logger.endTrigger();
  };
  /** Open an episode for `target` that waits on an effect, and return what settles it. */
  const waiting = (logger: EpisodeLogger, target: string, ts?: number): (() => void) => {
    logger.beginTrigger({ kind: "ui.click", target, ...(ts !== undefined ? { ts } : {}) });
    const save = logger.recordEffectStart("save", target);
    logger.endTrigger();
    return () => logger.recordEffectEnd(save, "save", "ok", null)();
  };

  // Each row: the outlet, what it holds while the first episode still waits on its effect, and how
  // to build it. `onEpisode` feeds append-only files, so it gets nothing ahead of an earlier
  // trigger; the two stores take a committed episode at once, at its trigger's place.
  const outlets: [string, string[], MakeOutlet][] = [
    ["list()", ["BBtn"], listOutlet],
    ["the localStorage mirror", ["BBtn"], mirrorOutlet],
    ["onEpisode", [], hookOutlet],
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

  it.each(outlets)("%s gets an episode once it is done, while a later one waits", (_, _w, make) => {
    const { logger, targets } = make();
    logger.beginTrigger({ kind: "ui.click", target: "ABtn" });
    const saveA = logger.recordEffectStart("save", "a");
    logger.endTrigger();
    logger.beginTrigger({ kind: "ui.click", target: "BBtn" });
    logger.recordEffectStart("save", "b");
    logger.endTrigger();
    logger.recordEffectEnd(saveA, "save", "ok", null)();
    expect(targets()).toEqual(["ABtn"]);
  });

  it.each<[string, string[], MakeOutlet]>([
    ["list()", ["ABtn", "CBtn"], listOutlet],
    ["the localStorage mirror", ["ABtn", "CBtn"], mirrorOutlet],
    ["onEpisode", ["ABtn"], hookOutlet],
  ])("%s holds %j while the middle episode waits, then puts it between the other two", (_, whileWaiting, make) => {
    const { logger, targets } = make();
    done(logger, "ABtn");
    const settleB = waiting(logger, "BBtn");
    done(logger, "CBtn");
    expect(targets()).toEqual(whileWaiting);

    settleB();
    expect(targets()).toEqual(["ABtn", "BBtn", "CBtn"]);
  });

  // The ring keeps the two episodes begun last, so the one that commits late is dropped from it as
  // it goes in; `onEpisode` still gets it, ahead of the two it held behind it.
  it.each<[string, string[], string[], MakeOutlet]>([
    ["list()", ["BBtn", "CBtn"], ["BBtn", "CBtn"], listOutlet],
    ["the localStorage mirror", ["BBtn", "CBtn"], ["BBtn", "CBtn"], mirrorOutlet],
    ["onEpisode", [], ["ABtn", "BBtn", "CBtn"], hookOutlet],
  ])("%s holds %j while the first episode waits in a full ring, then %j", (_, whileWaiting, after, make) => {
    const { logger, targets } = make({ memoryMax: 2, localStorageMax: 2 });
    const settleA = waiting(logger, "ABtn");
    done(logger, "BBtn");
    done(logger, "CBtn");
    expect(targets()).toEqual(whileWaiting);

    settleA();
    expect(targets()).toEqual(after);
  });

  it.each(
    outlets,
  )("%s keeps the order the triggers began in, whatever ts a caller hands them", (_, _w, make) => {
    const { logger, targets } = make();
    const settleA = waiting(logger, "ABtn", 2000);
    done(logger, "BBtn", 1000);
    settleA();
    expect(targets()).toEqual(["ABtn", "BBtn"]);
  });

  it("hands onCommit each episode as it commits, ahead of one begun before it that still waits", () => {
    const seen: (string | undefined)[] = [];
    const { logger } = makeLogger({ onCommit: (ep) => seen.push(ep.trigger.target) });
    const settleA = waiting(logger, "ABtn");
    done(logger, "BBtn");
    expect(seen).toEqual(["BBtn"]);

    settleA();
    expect(seen).toEqual(["BBtn", "ABtn"]);
  });

  it.each([
    "onCommit",
    "onEpisode",
  ] as const)("hands onEpisode every episode it held when %s throws, then throws", (hook) => {
    const seen: (string | undefined)[] = [];
    const failOnA = (ep: Episode): void => {
      if (ep.trigger.target === "ABtn") throw new Error("host failed");
    };
    const { logger } = makeLogger({
      onEpisode: (ep) => {
        seen.push(ep.trigger.target);
        if (hook === "onEpisode") failOnA(ep);
      },
      ...(hook === "onCommit" ? { onCommit: failOnA } : {}),
    });
    const settleA = waiting(logger, "ABtn");
    done(logger, "BBtn");

    expect(settleA).toThrow("host failed");
    expect(seen).toEqual(["ABtn", "BBtn"]);
    expect(logger.list().map((ep) => ep.trigger.target)).toEqual(["ABtn", "BBtn"]);
  });
});

describe("what the logger keeps alive", () => {
  /** A full collection, which Node exposes only under `--expose-gc` (the runtime's test config). */
  function collector(): () => void {
    const { gc } = globalThis as { gc?: () => void };
    if (gc === undefined) throw new Error("collecting garbage needs Node started with --expose-gc");
    return gc;
  }

  it("drops an episode the ring let go, behind one whose effect never settles, when no hook holds it", async () => {
    const gc = collector();
    const { logger } = makeLogger({ memoryMax: 1 });
    logger.beginTrigger({ kind: "ui.click", target: "HangBtn" });
    logger.recordEffectStart("save", null);
    logger.endTrigger();
    // Built in a function of its own, so nothing in this test holds the payloads but the logger.
    const refs = (() => {
      const payloads = [{ n: 1 }, { n: 2 }];
      for (const payload of payloads) {
        logger.beginTrigger({ kind: "ui.click", target: "Btn", payload });
        logger.endTrigger();
      }
      return payloads.map((payload) => new WeakRef(payload));
    })();
    // A WeakRef's target is held until the job that made it ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();

    expect(refs.map((ref) => ref.deref())).toEqual([undefined, { n: 2 }]);
  });
});
