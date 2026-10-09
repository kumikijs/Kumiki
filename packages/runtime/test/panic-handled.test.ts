// A `panic` step says whether the program handled the panic (runtime.md
// §10.5.1): `handled: true` for one an `error-boundary` caught and rendered its
// fallback for, and no field for any other. `isUnhandledPanic` is the one rule
// a reader asks, so the dev overlay and anything else that reports panics agree
// on which ones nothing handled.
//
// The apps here are hand-built the way codegen lowers what they stand for: a
// boundary is `try { body } catch (e) { _s.boundaryPanic(e, "<tile>") }`
// (`emit-tile.ts`'s `boundaryJs`), and a reducer that writes no slot returns
// an empty `slots`.

import type { AppShape, EpisodeStep, PanicStep, TileNode } from "@kumikijs/runtime";
import {
  _stdlib,
  _stdlibCore,
  createEpisodeLogger,
  isUnhandledPanic,
  mount,
} from "@kumikijs/runtime";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An app whose `Risky` tile panics whenever it renders, under a boundary when
 * `boundary` is set and under nothing otherwise. It renders once `reveal` has
 * written `shown`; `noop` writes no slot, and `boom` panics in its own body.
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
  const app: AppShape = {
    slots: { shown: { value: false } },
    caps: [],
    effects: {},
    init: [],
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
  };
  return app;
}

const dispatch = (app: AppShape, name: string): void =>
  (app as unknown as { _dispatch: (n: string, el: Record<string, unknown>) => void })._dispatch(
    name,
    {},
  );

/** The `panic` steps among `steps`, handled or not. */
function panicsIn(steps: readonly EpisodeStep[]): PanicStep[] {
  return steps.filter((s): s is PanicStep => s.kind === "panic");
}

describe("a panic step says whether it was handled", () => {
  let root: HTMLElement;
  let errSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    root.remove();
  });

  // `noop` writes no slot, so no `signal-update` follows the render and the
  // caught panic is the episode's last step. Nothing in its position or its
  // `location` says it was handled; the field does.
  it("is handled: true for a panic a boundary caught after a reducer that wrote no slot", () => {
    const app = makeApp(true);
    const logger = createEpisodeLogger();
    mount(app, root, { episodeLogger: logger });
    dispatch(app, "reveal");
    dispatch(app, "noop");
    const ep = logger.list().at(-1);
    expect(ep?.steps.map((s) => s.kind)).toEqual(["reducer", "panic"]);
    expect(ep?.steps.at(-1)).toMatchObject({
      kind: "panic",
      location: "Risky",
      category: "tile-render",
      handled: true,
    });
    expect(root.textContent).toContain("recovered: no secret");
    // Handled: not reported to the console the verification tiers watch.
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("carries no handled field for a render panic no boundary caught", () => {
    const app = makeApp(false);
    const logger = createEpisodeLogger();
    mount(app, root, { episodeLogger: logger });
    dispatch(app, "reveal");
    const [panic, ...rest] = panicsIn(logger.list().at(-1)?.steps ?? []);
    expect(rest).toHaveLength(0);
    expect(panic).toMatchObject({ location: "render", category: "tile-render" });
    expect(panic).not.toHaveProperty("handled");
    expect(errSpy).toHaveBeenCalled();
  });

  it("carries no handled field for a reducer panic", () => {
    const app = makeApp(true);
    const logger = createEpisodeLogger();
    mount(app, root, { episodeLogger: logger });
    dispatch(app, "boom");
    const [panic, ...rest] = panicsIn(logger.list().at(-1)?.steps ?? []);
    expect(rest).toHaveLength(0);
    expect(panic).toMatchObject({ location: `reducer "boom"`, category: "reducer" });
    expect(panic).not.toHaveProperty("handled");
  });

  it("is written by the logger only when the record says so", () => {
    const logger = createEpisodeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordPanic({ message: "caught", location: "Risky", handled: true });
    logger.recordPanic({ message: "uncaught", location: "render" });
    logger.endTrigger();
    const [caught, uncaught] = panicsIn(logger.list()[0]?.steps ?? []);
    expect(caught).toMatchObject({ message: "caught", handled: true });
    expect(uncaught?.message).toBe("uncaught");
    expect(uncaught).not.toHaveProperty("handled");
  });
});

describe("isUnhandledPanic", () => {
  const ts = 0;

  it("is true for a panic step with no handled field", () => {
    expect(isUnhandledPanic({ kind: "panic", message: "boom", ts })).toBe(true);
  });

  it("is false for a panic step a boundary handled", () => {
    expect(isUnhandledPanic({ kind: "panic", message: "boom", handled: true, ts })).toBe(false);
  });

  it("is false for a step that is not a panic", () => {
    expect(isUnhandledPanic({ kind: "effect-cancel", targetId: "load", ts })).toBe(false);
  });
});
