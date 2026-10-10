import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

function makeTimerApp(): AppShape {
  return bareApp({
    slots: { count: { value: 0 } },
    reducers: [
      {
        name: "tick",
        event: { kind: "timer", intervalMs: 100, name: "countdown" },
        apply: (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] }),
      },
      {
        name: "stop",
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [], stopTimers: ["countdown"] }),
      },
    ],
    root: () => ({ kind: "column", children: [{ kind: "heading", text: "timer" }] }),
  });
}

describe("named timers + stop-timer", () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    root = freshRoot();
  });
  afterEach(() => {
    vi.useRealTimers();
    root.remove();
  });

  const count = (app: AppShape): unknown => app.live?.count;

  it("fires a named timer until stop-timer clears it", () => {
    const app = makeTimerApp();
    const { dispose } = mount(app, root);
    vi.advanceTimersByTime(350);
    expect(count(app)).toBe(3);
    (app as MountedApp)._dispatch("stop", {});
    vi.advanceTimersByTime(500);
    expect(count(app)).toBe(3);
    dispose();
  });

  it("clears a running named timer on dispose", () => {
    const app = makeTimerApp();
    const { dispose } = mount(app, root);
    vi.advanceTimersByTime(150);
    expect(count(app)).toBe(1);
    dispose();
    vi.advanceTimersByTime(500);
    expect(count(app)).toBe(1);
  });
});
