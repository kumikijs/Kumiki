import type { AppShape, EpisodeStep, MountedApp, PanicStep, TileNode } from "@kumikijs/runtime";
import {
  _stdlib,
  _stdlibCore,
  createEpisodeLogger,
  isUnhandledPanic,
  mount,
} from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

/**
 * `Risky` panics whenever it renders, under a boundary (lowered as codegen lowers
 * `error-boundary`) when `boundary` is set. It renders once `reveal` has written
 * `shown`; `noop` writes no slot, and `boom` panics in its own body.
 */
function makeApp(boundary: boolean): AppShape {
  const risky = (): TileNode => {
    _stdlib.panic("no secret");
    return { kind: "text", text: "unreachable" };
  };
  const guarded = (): TileNode => {
    try {
      return risky();
    } catch (e) {
      const info = _stdlibCore.boundaryPanic(e, "Risky") as { message: string };
      return { kind: "text", text: `recovered: ${info.message}` };
    }
  };
  const app: AppShape = bareApp({
    slots: { shown: { value: false } },
    reducers: [
      {
        name: "noop",
        selector: { tile: "NoopBtn" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: {}, emits: [] }),
      },
      {
        name: "reveal",
        selector: { tile: "RevealBtn" },
        event: { kind: "ui", ev: "click" },
        apply: () => ({ slots: { shown: true }, emits: [] }),
      },
      {
        name: "boom",
        selector: { tile: "BoomBtn" },
        event: { kind: "ui", ev: "click" },
        apply: () => {
          _stdlib.panic("boom in reducer");
          return { slots: {}, emits: [] };
        },
      },
    ],
    root: () => ({
      kind: "column",
      children: app.live?.shown ? [boundary ? guarded() : risky()] : [],
    }),
  });
  return app;
}

/** Mount `app` with a logger, dispatch `reducers` in order, and return the root and the logger. */
function run(app: AppShape, ...reducers: string[]) {
  const root = freshRoot();
  const logger = createEpisodeLogger();
  mount(app, root, { episodeLogger: logger });
  for (const r of reducers) (app as MountedApp)._dispatch(r, {});
  return { root, logger };
}

const panicsIn = (steps: readonly EpisodeStep[] = []): PanicStep[] =>
  steps.filter((s): s is PanicStep => s.kind === "panic");

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a panic step says whether it was handled", () => {
  it("is handled: true for a panic a boundary caught after a reducer that wrote no slot", () => {
    const errors = captureConsole();
    const { root, logger } = run(makeApp(true), "reveal", "noop");
    const ep = logger.list().at(-1);
    expect(ep?.steps.map((s) => s.kind)).toEqual(["reducer", "panic"]);
    expect(ep?.steps.at(-1)).toMatchObject({
      kind: "panic",
      location: "Risky",
      category: "tile-render",
      handled: true,
    });
    expect(root.textContent).toContain("recovered: no secret");
    expect(errors).toEqual([]);
  });

  it.each([
    {
      name: "a render panic no boundary caught",
      boundary: false,
      reducer: "reveal",
      step: { location: "render", category: "tile-render" },
    },
    {
      name: "a reducer panic",
      boundary: true,
      reducer: "boom",
      step: { location: `reducer "boom"`, category: "reducer" },
    },
  ])("carries no handled field for $name", ({ boundary, reducer, step }) => {
    captureConsole();
    const { logger } = run(makeApp(boundary), reducer);
    const [panic, ...rest] = panicsIn(logger.list().at(-1)?.steps);
    expect(rest).toHaveLength(0);
    expect(panic).toMatchObject(step);
    expect(panic).not.toHaveProperty("handled");
  });

  it("is written by the logger only when the record says so", () => {
    const logger = createEpisodeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordPanic({ message: "caught", location: "Risky", handled: true });
    logger.recordPanic({ message: "uncaught", location: "render" });
    logger.endTrigger();
    const [caught, uncaught] = panicsIn(logger.list()[0]?.steps);
    expect(caught).toMatchObject({ message: "caught", handled: true });
    expect(uncaught?.message).toBe("uncaught");
    expect(uncaught).not.toHaveProperty("handled");
  });
});

describe("isUnhandledPanic", () => {
  it.each<[string, EpisodeStep, boolean]>([
    ["a panic step with no handled field", { kind: "panic", message: "boom", ts: 0 }, true],
    [
      "a panic step a boundary handled",
      { kind: "panic", message: "boom", handled: true, ts: 0 },
      false,
    ],
    ["a step that is not a panic", { kind: "effect-cancel", targetId: "load", ts: 0 }, false],
  ])("answers %s with %s", (_, step, unhandled) => {
    expect(isUnhandledPanic(step)).toBe(unhandled);
  });
});
