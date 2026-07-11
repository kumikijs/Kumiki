import { createEpisodeLogger, type EpisodeLogger } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

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

describe("EpisodeLogger §10.5", () => {
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
    });
    expect(ep.steps[0]).toHaveProperty("slot-diffs");
    expect(ep.steps[3]).toMatchObject({ kind: "signal-update" });
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

  it("carries stack / cause / category from recordPanic into the step (#162)", () => {
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

  it("attaches effect-end to the originating episode while it is still open", () => {
    const { logger } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    const tok = logger.recordEffectStart("load", null);
    logger.recordEffectEnd(tok, "load", "ok", { user: "a" })();
    logger.endTrigger();
    const ep = logger.list()[0]!;
    expect(ep.steps.map((s) => s.kind)).toEqual(["effect-start", "effect-end"]);
    expect(ep.status).toBe("completed");
  });

  it("defers commit and attaches async effect-end + chain reducer to the original episode", () => {
    const { logger } = makeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "AsyncBtn" });
    logger.recordReducer("kick", [], ["loadUser"]);
    const tok = logger.recordEffectStart("loadUser", null);
    // The synchronous handler returns here — async work still pending.
    logger.endTrigger();
    // No commit yet — effect still in flight.
    expect(logger.list()).toEqual([]);

    // ...later, effect resolves and triggers `.ok` reducer:
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
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
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
