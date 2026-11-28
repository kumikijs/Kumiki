import type { AppShape, EpisodeLogger, MountedApp, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp, keylessEffect, lifecycleReducer } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";
import { SINK_DOWN, throwingLogger } from "./helpers/episode-apps.ts";

const baseApp = (overrides: Partial<AppShape>): AppShape =>
  bareApp({ root: () => ({ kind: "text", text: "x" }), ...overrides });

describe("runtime: tile.mount / tile.unmount", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
  });

  it("fires tile.mount when a user-tile-named node first appears, and tile.unmount when it leaves", () => {
    const events: string[] = [];
    let visible = true;
    const named = (name: string, child: TileNode): TileNode => ({
      kind: "box",
      children: [child],
      props: { _tile: name },
    });
    const app: AppShape = baseApp({
      reducers: [
        lifecycleReducer('tile.mount("Panel")', (s) => {
          events.push("mount");
          return { slots: s, emits: [] };
        }),
        lifecycleReducer('tile.unmount("Panel")', (s) => {
          events.push("unmount");
          return { slots: s, emits: [] };
        }),
      ],
      root: () =>
        visible
          ? ({
              kind: "column",
              children: [named("Panel", { kind: "text", text: "p" })],
            } as TileNode)
          : ({ kind: "column", children: [{ kind: "text", text: "p" }] } as TileNode),
    });
    const { dispose } = mount(app, root);
    expect(events).toEqual(["mount"]);
    visible = false;
    app._rerender?.();
    expect(events).toEqual(["mount", "unmount"]);
    dispose();
  });

  it("fires for each name a node carries, in the order it lists them", () => {
    const events: string[] = [];
    let visible = true;
    const record = (event: string): ReducerSpec =>
      lifecycleReducer(event, (s) => {
        events.push(event);
        return { slots: s, emits: [] };
      });
    const app: AppShape = baseApp({
      reducers: [
        record('tile.mount("Outer")'),
        record('tile.mount("Inner")'),
        record('tile.unmount("Outer")'),
        record('tile.unmount("Inner")'),
      ],
      root: () =>
        ({
          kind: "column",
          children: visible
            ? [{ kind: "text", text: "p", props: { _tile: ["Outer", "Inner"] } }]
            : [],
        }) as TileNode,
    });
    const { dispose } = mount(app, root);
    expect(events).toEqual(['tile.mount("Outer")', 'tile.mount("Inner")']);
    visible = false;
    app._rerender?.();
    expect(events).toEqual([
      'tile.mount("Outer")',
      'tile.mount("Inner")',
      'tile.unmount("Outer")',
      'tile.unmount("Inner")',
    ]);
    dispose();
  });

  it("does not fire when only built-in tiles appear / disappear", () => {
    const events: string[] = [];
    let showCard = true;
    const app: AppShape = baseApp({
      reducers: [
        lifecycleReducer("tile.mount(card)", (s) => {
          events.push("mount-card");
          return { slots: s, emits: [] };
        }),
      ],
      root: () =>
        showCard
          ? ({ kind: "card", children: [{ kind: "text", text: "x" }] } as TileNode)
          : ({ kind: "text", text: "x" } as TileNode),
    });
    const { dispose } = mount(app, root);
    showCard = false;
    app._rerender?.();
    // Only user tiles carry a `_tile` marker; `card` is a built-in.
    expect(events).toEqual([]);
    dispose();
  });
});

describe("runtime: a lifecycle reducer that throws past its body", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  const NO_KEY = {
    A: new Error("no key for A"),
    B: new Error("no key for B"),
    C: new Error("no key for C"),
  };
  type Tile = keyof typeof NO_KEY;
  const named = (name: string): TileNode =>
    ({ kind: "box", children: [{ kind: "text", text: name }], props: { _tile: name } }) as TileNode;
  const thrownBy = (run: () => void): unknown => {
    try {
      run();
    } catch (e) {
      return e;
    }
    return undefined;
  };

  /**
   * `A` and `B` mount while `C` unmounts, in the render `go` starts, or in the first render when
   * `atMount`. Each of their lifecycle reducers, named after its event, records that it ran.
   * Those of the tiles in `emitting` emit an effect whose key throws, so they throw past their
   * bodies.
   */
  function tileApp(opts: { atMount?: boolean; emitting?: Tile[] } = {}) {
    const events: string[] = [];
    let shown: Tile[] = opts.atMount ? ["A", "B"] : ["C"];
    const emitting = new Set(opts.emitting ?? []);
    const record = (event: string, tile: Tile): ReducerSpec => ({
      name: event,
      event: { kind: "lifecycle", name: event },
      apply: (s) => {
        events.push(event);
        return {
          slots: s,
          emits: emitting.has(tile) ? [{ effect: `save${tile}`, args: [tile] }] : [],
        };
      },
    });
    const app: AppShape = baseApp({
      effects: {
        saveA: keylessEffect("saveA", () => NO_KEY.A),
        saveB: keylessEffect("saveB", () => NO_KEY.B),
        saveC: keylessEffect("saveC", () => NO_KEY.C),
      },
      reducers: [
        record('tile.mount("A")', "A"),
        record('tile.mount("B")', "B"),
        record('tile.unmount("C")', "C"),
        {
          name: "go",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            shown = ["A", "B"];
            return { slots: s, emits: [] };
          },
        },
      ],
      root: () => ({ kind: "column", children: shown.map(named) }) as TileNode,
    });
    return { app, events };
  }

  const ALL = ['tile.mount("A")', 'tile.mount("B")', 'tile.unmount("C")'];

  it.each([
    {
      source: "the key of what it emitted",
      emitting: ["A"] as Tile[],
      logger: (): EpisodeLogger => createEpisodeLogger(),
      message: "no key for A",
    },
    {
      source: "the episode logger recording it",
      emitting: [] as Tile[],
      logger: (): EpisodeLogger =>
        throwingLogger("recordReducer", (name) => name === 'tile.mount("A")'),
      message: SINK_DOWN,
    },
  ])("runs the render's other tile.mount and tile.unmount reducers when one throws past its body through $source, then hands the throw on", ({
    emitting,
    logger,
    message,
  }) => {
    const { app, events } = tileApp({ emitting });
    const { dispose } = mount(app, root, { episodeLogger: logger() });
    const e = thrownBy(() => (app as MountedApp)._dispatch("go", {}));
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(AggregateError);
    expect((e as Error).message).toBe(message);
    expect(events).toEqual(ALL);
    expect(root.textContent).toBe("AB");
    // They ran in that render, so the next one owes none of them.
    app._rerender?.();
    expect(events).toEqual(ALL);
    dispose();
  });

  it("hands several throws on as one AggregateError holding each, in the order their reducers ran", () => {
    const { app, events } = tileApp({ emitting: ["C", "A"] });
    const { dispose } = mount(app, root);
    const e = thrownBy(() => (app as MountedApp)._dispatch("go", {}));
    expect(e).toBeInstanceOf(AggregateError);
    expect((e as AggregateError).errors).toEqual([NO_KEY.A, NO_KEY.C]);
    expect((e as AggregateError).message).toBe(
      '2 steps after reducer "go" threw: no key for A; no key for C',
    );
    expect(events).toEqual(ALL);
    dispose();
  });

  it("runs every tile.mount reducer of the first render when one throws, then throws it out of mount", () => {
    const { app, events } = tileApp({ atMount: true, emitting: ["A"] });
    expect(thrownBy(() => mount(app, root))).toBe(NO_KEY.A);
    expect(events).toEqual(['tile.mount("A")', 'tile.mount("B")']);
  });

  it("names the tile reducers in the AggregateError the first render throws out of mount", () => {
    const { app, events } = tileApp({ atMount: true, emitting: ["A", "B"] });
    const e = thrownBy(() => mount(app, root));
    expect((e as AggregateError).errors).toEqual([NO_KEY.A, NO_KEY.B]);
    expect((e as AggregateError).message).toBe(
      "2 tile.mount and tile.unmount reducers threw: no key for A; no key for B",
    );
    expect(events).toEqual(['tile.mount("A")', 'tile.mount("B")']);
  });

  /** Two reducers on `event`, in that order; `first` throws past its body. */
  function twoOn(event: string) {
    const ran: string[] = [];
    const reducer = (name: string, emits: boolean): ReducerSpec => ({
      name,
      event: { kind: "lifecycle", name: event },
      apply: (s) => {
        ran.push(name);
        return { slots: s, emits: emits ? [{ effect: "saveA", args: [name] }] : [] };
      },
    });
    const app: AppShape = baseApp({
      effects: { saveA: keylessEffect("saveA", () => NO_KEY.A) },
      reducers: [reducer("first", true), reducer("second", false)],
      root: () => named("A"),
    });
    return { app, ran };
  }

  it.each([
    'tile.mount("A")',
    "app.start",
  ])("runs every %s reducer when an earlier one throws past its body, then throws it out of mount", (event) => {
    const { app, ran } = twoOn(event);
    expect(thrownBy(() => mount(app, root))).toBe(NO_KEY.A);
    expect(ran).toEqual(["first", "second"]);
  });

  it("runs every app.online reducer when an earlier one throws past its body", () => {
    const { app, ran } = twoOn("app.online");
    const { dispose } = mount(app, root);
    thrownBy(() => window.dispatchEvent(new Event("online")));
    expect(ran).toEqual(["first", "second"]);
    dispose();
  });
});

describe("runtime: route.error fallback", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it("fires route.error(<pattern>) with a tile-render $event when the route's tile throws", () => {
    const captured: { event?: Record<string, unknown> } = {};
    let mode: "boom" | "ok" = "boom";
    const app: AppShape = baseApp({
      reducers: [
        lifecycleReducer('route.error("/")', (s, payload) => {
          captured.event = payload.$event as Record<string, unknown>;
          mode = "ok";
          return { slots: s, emits: [] };
        }),
      ],
      routes: [
        {
          pattern: "/",
          tile: (): TileNode => {
            if (mode === "boom") throw new Error("kaboom");
            return { kind: "text", text: "recovered" };
          },
        },
      ],
    });
    const { dispose } = mount(app, root);
    expect(captured.event?.message).toBe("kaboom");
    expect(captured.event?.pattern).toBe("/");
    expect(captured.event?.category).toBe("tile-render");
    expect(captured.event).not.toHaveProperty("stack");
    expect(captured.event?.cause).toEqual({ _tag: "None" });
    expect(root.textContent).toContain("recovered");
    dispose();
  });

  it("fires route.error once for a render that stays broken, and shows the panic display", () => {
    let fired = 0;
    const app: AppShape = baseApp({
      reducers: [
        lifecycleReducer('route.error("/")', (s) => {
          fired++;
          return { slots: s, emits: [] };
        }),
      ],
      routes: [
        {
          pattern: "/",
          tile: (): TileNode => {
            throw new Error("kaboom");
          },
        },
      ],
    });
    const { dispose } = mount(app, root);
    expect(fired).toBe(1);
    expect(root.querySelector("[data-kumiki-panic]")).not.toBeNull();
    dispose();
  });

  it("route.error $event carries every declared PanicInfo field", () => {
    const captured: { event?: Record<string, unknown> } = {};
    let mode: "boom" | "ok" = "boom";
    const logger = createEpisodeLogger({ memoryMax: 10 });
    const app: AppShape = baseApp({
      reducers: [
        lifecycleReducer('route.error("/")', (s, payload) => {
          captured.event = payload.$event as Record<string, unknown>;
          mode = "ok";
          return { slots: s, emits: [] };
        }),
      ],
      routes: [
        {
          pattern: "/",
          tile: (): TileNode => {
            if (mode === "boom") throw new Error("kaboom", { cause: new Error("the socket") });
            return { kind: "text", text: "recovered" };
          },
        },
      ],
    });
    const { dispose } = mount(app, root, { episodeLogger: logger });
    expect(captured.event?.location).toBe("render");
    expect(captured.event?.message).toBe("kaboom");
    expect(captured.event?.category).toBe("tile-render");
    expect(captured.event?.pattern).toBe("/");
    expect(captured.event?.cause).toEqual({ _tag: "Some", _0: "the socket" });
    expect(captured.event?.["episode-id"]).toEqual({ _tag: "None" });
    dispose();
  });

  it("reports a throw past a route.error reducer's body as its own, and still runs the next one", () => {
    const errors = captureConsole("error");
    const appErrors: unknown[] = [];
    let mode: "boom" | "ok" = "boom";
    let nextRan = false;
    const routeError = { kind: "lifecycle", name: 'route.error("/")' } as const;
    const app: AppShape = baseApp({
      effects: { save: keylessEffect("save", () => new Error("no key for this page")) },
      reducers: [
        {
          name: "recover",
          event: routeError,
          apply: (s) => {
            mode = "ok";
            return { slots: s, emits: [{ effect: "save", args: ["page"] }] };
          },
        },
        {
          name: "note",
          event: routeError,
          apply: (s) => {
            nextRan = true;
            return { slots: s, emits: [] };
          },
        },
        lifecycleReducer("app.error", (s, payload) => {
          appErrors.push(payload.$event);
          return { slots: s, emits: [] };
        }),
      ],
      routes: [
        {
          pattern: "/",
          tile: (): TileNode => {
            if (mode === "boom") throw new Error("kaboom");
            return { kind: "text", text: "recovered" };
          },
        },
      ],
    });
    const { dispose } = mount(app, root);
    expect(nextRan).toBe(true);
    expect(root.textContent).toContain("recovered");
    expect(errors.filter((line) => line.includes('reducer "recover"'))).toEqual([
      expect.stringContaining("no key for this page"),
    ]);
    expect(appErrors).toEqual([
      expect.objectContaining({
        message: "no key for this page",
        location: 'reducer "recover"',
        category: "reducer",
      }),
    ]);
    dispose();
  });
});
