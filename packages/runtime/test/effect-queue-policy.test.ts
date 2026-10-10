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
          emits: ["a", "b", "c"].map((arg) => ({ effect: "work", args: [arg] })),
        }),
      },
      {
        name: "kill",
        event: { kind: "ui", ev: "click" },
        // Every `work` emit shares the key `_`, so this id names the queue.
        apply: () => ({ slots: {}, emits: [{ effect: "cancel", args: ["work:_"] }] }),
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

  it("releases a queued launch that http.cancel cancelled", async () => {
    const { app, log } = makeQueueApp();
    const { dispose } = mount(app, host);
    dispatch(app, "go");
    await tick(5);
    dispatch(app, "kill");
    await tick(120);
    // `a` was already running when the cancel landed.
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start a"]);
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
