// Runtime-unit coverage for the lifecycle events introduced in #81. These tests
// construct an AppShape directly to drive the runtime in isolation — the
// cross-cutting end-to-end coverage (parser → codegen → runtime) lives in
// packages/tests/lifecycle-events.test.ts.

import type { AppShape, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function baseApp(overrides: Partial<AppShape>): AppShape {
  return {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => ({ kind: "text", text: "x" }),
    ...overrides,
  };
}

function lifecycleReducer(name: string, apply: ReducerSpec["apply"]): ReducerSpec {
  return {
    name: `r-${name.replace(/[^a-z0-9]/gi, "")}`,
    event: { kind: "lifecycle", name },
    apply,
  };
}

describe("runtime: tile.mount / tile.unmount (#81)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
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
      slots: {},
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
    // Trigger a re-render by toggling a live slot.
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
    // No `_tile` marker on `card` → the reducer is never matched. The
    // user-defined-only contract is the point: `card` is a built-in.
    expect(events).toEqual([]);
    dispose();
  });
});

describe("runtime: route.error fallback (#81)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("fires route.error(<pattern>) when rendering the route's tile throws", () => {
    const captured: { event?: { message: string; pattern: string } } = {};
    let mode: "boom" | "ok" = "boom";
    const app: AppShape = baseApp({
      reducers: [
        lifecycleReducer('route.error("/")', (s, payload) => {
          captured.event = payload.$event as { message: string; pattern: string };
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
    // The re-render after the handler ran the second branch — the DOM shows
    // the recovery text, not the top-level panic fallback.
    expect(root.textContent).toContain("recovered");
    dispose();
  });
});
