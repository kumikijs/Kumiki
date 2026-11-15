import type { AppShape, Episode, MountedApp } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";
import { tick } from "./helpers/time.ts";

/** Each `go` emits three 20ms `work` invocations under policy=queue. */
function makeQueueApp(): { app: AppShape; log: string[]; peak: () => number } {
  const log: string[] = [];
  let running = 0;
  let peak = 0;
  const app = bareApp({
    slots: { n: { value: 0 } },
    caps: ["log.write", "http.cancel"],
    effects: {
      cancel: {
        name: "cancel",
        cap: "http.cancel",
        invoke: async () => ({ kind: "ok", value: null }),
      },
      work: {
        name: "work",
        cap: "log.write",
        policy: { kind: "queue" },
        invoke: async (input) => {
          running += 1;
          peak = Math.max(peak, running);
          log.push(`start ${String(input)}`);
          await tick(20);
          log.push(`end ${String(input)}`);
          running -= 1;
          return { kind: "ok", value: null };
        },
      },
    },
    reducers: [
      {
        name: "go",
        event: { kind: "ui", ev: "click" },
        apply: () => ({
          slots: {},
          // Each emit carries the id an `emit` expression stamps, so `kill` can name one.
          emits: ["a", "b", "c"].map((arg) => ({ effect: "work", args: [arg], id: `work#${arg}` })),
        }),
      },
      {
        name: "kill",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["work#b"] }] }),
      },
    ],
    root: () => ({ kind: "column", children: [] }),
  });
  return { app, log, peak: () => peak };
}

describe("policy=queue runs one at a time", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = freshRoot();
  });
  afterEach(() => {
    host.remove();
  });

  const dispatch = (app: AppShape, name: string): void => (app as MountedApp)._dispatch(name, {});

  it("never has two invocations in flight, and keeps the order they were emitted", async () => {
    const { app, log, peak } = makeQueueApp();
    const { dispose } = mount(app, host);
    dispatch(app, "go");
    await tick(200);
    expect(peak()).toBe(1);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    dispose();
  });

  it("releases the queued launch that http.cancel cancelled, and only that one", async () => {
    const { app, log } = makeQueueApp();
    const logger = createEpisodeLogger();
    const { dispose } = mount(app, host, { episodeLogger: logger });
    dispatch(app, "go");
    await tick(5);
    dispatch(app, "kill");
    await tick(120);
    // `kill` lands while `a` runs, so `b` is still waiting: it is removed and never starts.
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start a", "start c"]);
    const byReducer = (name: string) =>
      logger.list().find((ep) => ep.steps.some((st) => st.kind === "reducer" && st.name === name));
    const go = byReducer("go");
    const kill = byReducer("kill");
    expect(go?.status).toBe("completed");
    const goSteps = go?.steps ?? [];
    expect(goSteps.filter((st) => st.kind === "effect-cancel")).toEqual([
      expect.objectContaining({ targetId: "work" }),
    ]);
    expect(goSteps.filter((st) => st.kind === "effect-end")).toHaveLength(2);
    expect(kill?.steps.filter((st) => st.kind === "effect-cancel")).toEqual([
      expect.objectContaining({ targetId: "work#b" }),
    ]);
    dispose();
  });

  it("finds the entry a cancel names in whichever queue holds it", async () => {
    const log: string[] = [];
    const queued = (name: string) => ({
      name,
      cap: "log.write",
      policy: { kind: "queue" as const },
      invoke: async (input: unknown) => {
        log.push(`start ${String(input)}`);
        await tick(10);
        return { kind: "ok" as const, value: null };
      },
    });
    const app = bareApp({
      caps: ["log.write", "http.cancel"],
      effects: {
        cancel: {
          name: "cancel",
          cap: "http.cancel",
          invoke: async () => ({ kind: "ok", value: null }),
        },
        workX: queued("workX"),
        workY: queued("workY"),
      },
      reducers: [
        {
          name: "go",
          event: { kind: "ui", ev: "click" },
          apply: () => ({
            slots: {},
            // `workX` is emitted first, so its queue is the first one a cancel looks through.
            emits: [
              ...["x1", "x2", "x3"].map((arg) => ({
                effect: "workX",
                args: [arg],
                id: `workX#${arg}`,
              })),
              ...["y1", "y2", "y3"].map((arg) => ({
                effect: "workY",
                args: [arg],
                id: `workY#${arg}`,
              })),
            ],
          }),
        },
        {
          name: "kill",
          event: { kind: "ui", ev: "click" },
          apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["workY#y2"] }] }),
        },
      ],
      root: () => ({ kind: "column", children: [] }),
    });
    const { dispose } = mount(app, host);
    dispatch(app, "go");
    await tick(3);
    dispatch(app, "kill");
    await tick(100);
    expect(log.filter((l) => l.startsWith("start x"))).toEqual([
      "start x1",
      "start x2",
      "start x3",
    ]);
    expect(log.filter((l) => l.startsWith("start y"))).toEqual(["start y1", "start y3"]);
    dispose();
  });

  it("releases a queued launch that unmount cancelled", async () => {
    const { app } = makeQueueApp();
    const logger = createEpisodeLogger();
    const { dispose } = mount(app, host, { episodeLogger: logger });
    dispatch(app, "go");
    await tick(5);
    dispose();
    await tick(120);
    const steps = logger.list().flatMap((e: Episode) => e.steps.map((st) => st.kind));
    expect(steps.filter((k) => k === "effect-cancel")).toHaveLength(2);
    expect(steps.filter((k) => k === "effect-end")).toHaveLength(1);
  });
});
