import type { AppShape, TileNode } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp, lifecycleReducer } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

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

describe("runtime: route.error fallback", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
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
});
