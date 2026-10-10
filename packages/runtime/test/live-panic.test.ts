import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { _stdlib, createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

function makePanicApp(boom: () => never = () => _stdlib.panic("boom in reducer")): {
  app: AppShape;
  events: unknown[];
} {
  const events: unknown[] = [];
  const app = bareApp({
    slots: { n: { value: 0 }, lastError: { value: "" } },
    reducers: [
      { name: "boom", event: { kind: "ui", ev: "click" }, apply: boom },
      {
        name: "ok",
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { n: (live.n as number) + 1 }, emits: [] }),
      },
      {
        name: "onError",
        event: { kind: "lifecycle", name: "app.error" },
        apply: (_live, payload) => {
          events.push(payload.$event);
          return {
            slots: { lastError: (payload.$event as { message: string }).message },
            emits: [],
          };
        },
      },
    ],
    root: () => ({ kind: "column", children: [{ kind: "heading", text: "panic-app" }] }),
  });
  return { app, events };
}

describe("live panic handling", () => {
  let root: HTMLElement;
  let errors: string[];
  beforeEach(() => {
    root = freshRoot();
    errors = captureConsole("error");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    root.remove();
  });

  const dispatch = (app: AppShape, name: string): void => (app as MountedApp)._dispatch(name, {});

  it("keeps a reducer panic inside the dispatch, writes nothing, and reports it", () => {
    const { app } = makePanicApp();
    mount(app, root);
    expect(() => dispatch(app, "boom")).not.toThrow();
    expect(app.live?.n).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("stays interactive after a reducer panic", () => {
    const { app } = makePanicApp();
    mount(app, root);
    dispatch(app, "boom");
    dispatch(app, "ok");
    expect(app.live?.n).toBe(1);
  });

  it("records the panic to the episode log with location, stack and category", () => {
    const { app } = makePanicApp();
    const logger = createEpisodeLogger();
    mount(app, root, { episodeLogger: logger });
    dispatch(app, "boom");
    const last = logger.list().at(-1);
    expect(last?.status).toBe("panic");
    expect(last?.steps.find((s) => s.kind === "panic")).toMatchObject({
      message: "boom in reducer",
      location: 'reducer "boom"',
      stack: expect.stringMatching(/at .+/),
      category: "reducer",
    });
  });

  it("logs the stack and each cause as indented continuation lines", () => {
    const { app } = makePanicApp(() => {
      throw new Error("boom detail", { cause: new Error("root cause") });
    });
    mount(app, root);
    dispatch(app, "boom");
    const joined = errors.join("\n");
    // The first line is a grep target for the verification tiers.
    expect(joined).toMatch(/^\[kumiki\] (?:panic|error) in reducer "boom": boom detail/m);
    expect(joined).toMatch(/\n {2}at .+/);
    expect(joined).toContain("Caused by: root cause");
  });

  it("hands app.error the declared PanicInfo fields and keeps dev-only ones in the log", () => {
    const { app, events } = makePanicApp();
    mount(app, root);
    dispatch(app, "boom");
    expect(app.live?.lastError).toBe("boom in reducer");
    const ev = events[0] as Record<string, unknown>;
    expect(ev).toMatchObject({
      message: "boom in reducer",
      location: 'reducer "boom"',
      category: "reducer",
      cause: { _tag: "None" },
    });
    expect(ev).not.toHaveProperty("stack");
    expect(JSON.stringify(ev)).not.toContain("at ");
  });

  it("catches a render panic with no error boundary at the top level", () => {
    const app = bareApp({ root: () => _stdlib.panic("render boom") });
    expect(() => mount(app, root)).not.toThrow();
    expect(root.textContent ?? "").toContain("render boom");
    expect(errors.length).toBeGreaterThan(0);
  });
});
