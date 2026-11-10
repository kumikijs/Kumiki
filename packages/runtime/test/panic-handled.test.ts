import type { AppShape, EpisodeStep, PanicStep, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { _stdlib, createEpisodeLogger, isUnhandledPanic } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { bareApp, boundaryAround, lifecycleReducer } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { type LoggedMount, mountLogged } from "./helpers/episode-apps.ts";

const risky = (): TileNode => {
  _stdlib.panic("no secret");
  return { kind: "text", text: "unreachable" };
};

const clickOn = (name: string, tile: string, apply: ReducerSpec["apply"]): ReducerSpec => ({
  name,
  selector: { tile },
  event: { kind: "ui", ev: "click" },
  apply,
});

/** `reveal` writes `shown`; `noop` writes no slot; `boom` panics in its own body. */
const REDUCERS: ReducerSpec[] = [
  clickOn("noop", "NoopBtn", () => ({ slots: {}, emits: [] })),
  clickOn("reveal", "RevealBtn", () => ({ slots: { shown: true }, emits: [] })),
  clickOn("boom", "BoomBtn", () => {
    _stdlib.panic("boom in reducer");
    return { slots: {}, emits: [] };
  }),
];

/**
 * `Risky` panics whenever it renders, which it does once `reveal` has written `shown`. `guard`
 * wraps it, as `boundaryAround` does or not at all.
 */
function makeApp(guard: (body: () => TileNode) => TileNode = (body) => body()): AppShape {
  const app: AppShape = bareApp({
    slots: { shown: { value: false } },
    reducers: REDUCERS,
    root: () => ({ kind: "column", children: app.live?.shown ? [guard(risky)] : [] }),
  });
  return app;
}

const guarded = (body: () => TileNode): TileNode => boundaryAround("Risky", body);

/**
 * `/` renders `Risky` with no boundary once `reveal` has run. Its `route.error` reducer puts
 * `shown` back when `recovers`, and otherwise leaves the route broken.
 */
function routedApp(recovers: boolean): AppShape {
  const app: AppShape = bareApp({
    slots: { shown: { value: false } },
    reducers: [
      ...REDUCERS,
      lifecycleReducer('route.error("/")', () => ({
        slots: recovers ? { shown: false } : {},
        emits: [],
      })),
    ],
    routes: [
      {
        pattern: "/",
        tile: () => (app.live?.shown ? risky() : { kind: "text", text: "calm" }),
      },
    ],
  });
  return app;
}

/** Mount `app` with a logger and dispatch `reducers` in order; the mount goes when the test ends. */
function run(app: AppShape, ...reducers: string[]): LoggedMount {
  const mounted = mountLogged(app);
  onTestFinished(mounted.dispose);
  for (const r of reducers) mounted.dispatch(r, {});
  return mounted;
}

const panicsIn = (steps: readonly EpisodeStep[] = []): PanicStep[] =>
  steps.filter((s): s is PanicStep => s.kind === "panic");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a panic step says whether it was handled", () => {
  it("is handled: true for a panic a boundary caught after a reducer that wrote no slot", () => {
    const errors = captureConsole();
    const { root, logger } = run(makeApp(guarded), "reveal", "noop");
    const ep = logger.list().at(-1);
    expect(ep?.steps.map((s) => s.kind)).toEqual(["reducer", "panic"]);
    expect(ep?.steps.at(-1)).toMatchObject({
      kind: "panic",
      message: "no secret",
      location: "Risky",
      category: "tile-render",
      handled: true,
    });
    expect(root.textContent).toBe(`fallback episode: ${ep?.id}`);
    expect(errors).toEqual([]);
  });

  it.each([
    {
      name: "a render panic no boundary caught",
      app: () => makeApp(),
      reducer: "reveal",
      steps: [{ location: "render", category: "tile-render" }],
    },
    {
      name: "a reducer panic",
      app: () => makeApp(guarded),
      reducer: "boom",
      steps: [{ location: `reducer "boom"`, category: "reducer" }],
    },
    {
      name: "a render panic a route.error reducer was told about",
      app: () => routedApp(true),
      reducer: "reveal",
      steps: [{ location: "render", category: "tile-render" }],
    },
    {
      name: "a render panic a route.error reducer was told about, and the render after it",
      app: () => routedApp(false),
      reducer: "reveal",
      steps: [
        { location: "render", category: "tile-render" },
        { location: "render", category: "tile-render" },
      ],
    },
  ])("carries no handled field for $name", ({ app, reducer, steps }) => {
    captureConsole();
    const { logger } = run(app(), reducer);
    const panics = panicsIn(logger.list().at(-1)?.steps);
    expect(panics).toMatchObject(steps);
    for (const panic of panics) expect(panic).not.toHaveProperty("handled");
  });

  it("is written when the boundary catches, so a fallback that panics in turn adds a panic nothing handled", () => {
    captureConsole();
    const breaks = (): TileNode => {
      _stdlib.panic("the fallback broke too");
      return { kind: "text", text: "unreachable" };
    };
    const { logger } = run(
      makeApp((body) => boundaryAround("Risky", body, breaks)),
      "reveal",
    );
    const [caught, thrown, ...rest] = panicsIn(logger.list().at(-1)?.steps);
    expect(rest).toEqual([]);
    expect(caught).toMatchObject({ message: "no secret", location: "Risky", handled: true });
    expect(thrown).toMatchObject({ message: "the fallback broke too", location: "render" });
    expect(thrown).not.toHaveProperty("handled");
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

  it("leaves a handled panic a panic step where it answers false", () => {
    const read = (s: EpisodeStep): string => {
      if (isUnhandledPanic(s)) return `unhandled: ${s.message}`;
      return s.kind === "panic" ? `handled: ${s.message}` : s.kind;
    };
    expect(read({ kind: "panic", message: "boom", handled: true, ts: 0 })).toBe("handled: boom");
    expect(read({ kind: "panic", message: "boom", ts: 0 })).toBe("unhandled: boom");
  });
});
