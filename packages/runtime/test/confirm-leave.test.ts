// Issue #82: `confirm` built-in effect (lifecycle §7.6) + route.leave guard
// callbacks (routing §3.5.2). Asserts the modal renders on top of the OLD
// route's tile, that Yes commits the held transition (and runs the user's
// onYes reducer), and that No reverts the router back to the old path.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppShape, ParsedRoute } from "../src/core.ts";
import { installConfirm } from "../src/effects-confirm.ts";
import { mount } from "../src/index.ts";

type Hooked = AppShape & {
  _dispatch?: (name: string, el: Record<string, unknown>) => void;
  _navigate?: (path: string, replace?: boolean) => void;
  _resolveLeave?: (outcome: "yes" | "no") => void;
};

let target: HTMLElement;
beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
});
afterEach(() => {
  target.remove();
  for (const m of Array.from(document.querySelectorAll("[data-kumiki-confirm]"))) m.remove();
});

function leaveGuardApp(editPattern = "/edit"): AppShape {
  // A two-route app whose `route.leave(editPattern)` guard emits `confirm` when
  // `dirty` is true. `continueLeave` clears `dirty`; `stayHere` is a noop.
  const app: AppShape = {
    slots: {
      dirty: { value: false },
      saved: { value: 0 },
      visits: { value: 0 },
    },
    caps: ["notification.show"],
    reducers: [
      {
        name: "edit",
        selector: { tile: "EditField" },
        event: { kind: "ui", ev: "input" },
        apply: (slots) => ({ slots: { ...slots, dirty: true }, emits: [] }),
      },
      {
        name: "save",
        selector: { tile: "SaveBtn" },
        event: { kind: "ui", ev: "click" },
        apply: (slots) => ({
          slots: { ...slots, dirty: false, saved: (slots.saved as number) + 1 },
          emits: [],
        }),
      },
      {
        name: "guardEdit",
        event: { kind: "lifecycle", name: `route.leave(${JSON.stringify(editPattern)})` },
        apply: (slots) => ({
          slots,
          emits: slots.dirty
            ? [
                {
                  effect: "confirm",
                  args: [
                    {
                      title: "Discard changes?",
                      message: "You have unsaved edits.",
                      onYes: "continueLeave",
                      onNo: "stayHere",
                    },
                  ],
                },
              ]
            : [],
        }),
      },
      {
        name: "onEnterHome",
        event: { kind: "lifecycle", name: 'route.enter("/")' },
        apply: (slots) => ({
          slots: { ...slots, visits: (slots.visits as number) + 1 },
          emits: [],
        }),
      },
      {
        name: "continueLeave",
        event: { kind: "ui", ev: "click" },
        apply: (slots) => ({ slots: { ...slots, dirty: false }, emits: [] }),
      },
      {
        name: "stayHere",
        event: { kind: "ui", ev: "click" },
        apply: (slots) => ({ slots, emits: [] }),
      },
    ],
    effects: {},
    init: [],
    routes: [
      {
        pattern: "/",
        tile: () => ({
          kind: "page",
          children: [
            { kind: "heading", text: "Home" },
            { kind: "link", to: "/edit", text: "Go edit" },
          ],
        }),
      },
      {
        pattern: editPattern,
        tile: () => ({
          kind: "page",
          children: [
            { kind: "heading", text: "Editor" },
            { kind: "link", to: "/", text: "Back home" },
          ],
        }),
      },
    ],
  };
  return app;
}

function getModal(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-kumiki-confirm]");
}

describe("installConfirm — confirm effect registration", () => {
  it("registers the confirm effect behind notification.show", async () => {
    const app: AppShape = {
      slots: {},
      caps: ["notification.show"],
      reducers: [],
      effects: {},
      init: [],
      routes: [],
    };
    const handle = mount(app, target);
    expect(app.effects.confirm).toBeDefined();
    expect(app.effects.confirm?.cap).toBe("notification.show");
    handle.dispose();
  });

  it("installConfirm itself can be wired alongside mountCore-style mounts", () => {
    expect(typeof installConfirm).toBe("function");
  });
});

describe("route.leave guard with confirm — Yes commits the transition", () => {
  it("holds nav until Yes, then commits + fires onYes reducer + route.enter", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      // Mark dirty so the leave guard will emit confirm.
      app._dispatch?.("edit", {});
      expect(app.live?.dirty).toBe(true);
      expect(getModal()).toBeNull();

      // Trigger navigation away from /edit — leave guard emits confirm.
      app._navigate?.("/");
      // Effect dispatch resolves on a microtask; let it run.
      await Promise.resolve();
      await Promise.resolve();
      const modal = getModal();
      expect(modal, "confirm modal must appear").not.toBeNull();
      // The OLD route's tile is still showing underneath.
      expect(target.textContent).toContain("Editor");
      expect(target.textContent).not.toContain("Home");

      // Click Yes — continueLeave runs first (clears dirty), then the
      // held transition commits and route.enter("/") fires.
      const yes = modal?.querySelector<HTMLButtonElement>(
        "button[data-kumiki-confirm-action='yes']",
      );
      yes?.click();
      await Promise.resolve();

      expect(getModal()).toBeNull();
      expect(app.live?.dirty).toBe(false);
      expect(target.textContent).toContain("Home");
      // The route.enter("/") reducer fired.
      expect(app.live?.visits).toBe(1);
    } finally {
      handle.dispose();
    }
  });
});

describe("route.leave guard with confirm — No reverts the transition", () => {
  it("rolls back to the old route on No and runs the onNo reducer", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      app._dispatch?.("edit", {});
      app._navigate?.("/");
      await Promise.resolve();
      await Promise.resolve();
      expect(getModal()).not.toBeNull();

      const no = getModal()?.querySelector<HTMLButtonElement>(
        "button[data-kumiki-confirm-action='no']",
      );
      no?.click();
      await Promise.resolve();

      expect(getModal()).toBeNull();
      // dirty stays true — stayHere is a noop and the runtime reverted the
      // nav without firing the Home `route.enter` (visits is still 0).
      expect(app.live?.dirty).toBe(true);
      expect(app.live?.visits).toBe(0);
      expect(target.textContent).toContain("Editor");
      expect(target.textContent).not.toContain("Home");
    } finally {
      handle.dispose();
    }
  });

  it("never opens a confirm modal when the guard's condition is false", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      // dirty is initially false — the leave guard emits nothing, nav goes
      // through without a modal.
      app._navigate?.("/");
      await Promise.resolve();
      expect(getModal()).toBeNull();
      expect(target.textContent).toContain("Home");
      expect(app.live?.visits).toBe(1);
    } finally {
      handle.dispose();
    }
  });
});

/** The ambient URL the history router reads and writes. */
function href(): string {
  return location.pathname + location.search + location.hash;
}

/** Mount on the history router at `start`, with unsaved edits. */
function mountDirtyAt(app: Hooked, start: string): { dispose: () => void } {
  history.replaceState(null, "", start);
  const handle = mount(app, target);
  app._dispatch?.("edit", {});
  expect(app.live?.dirty).toBe(true);
  return handle;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("route.leave guard — what counts as leaving (routing §3.4)", () => {
  it("a query-only move stays on the route, so the guard never asks", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mountDirtyAt(app, "/edit?tab=a");
    try {
      app._navigate?.("/edit?tab=b");
      await settle();
      expect(getModal()).toBeNull();
      expect(href()).toBe("/edit?tab=b");
      expect((app.live?.route as ParsedRoute).query).toEqual({ tab: "b" });
    } finally {
      handle.dispose();
    }
  });

  it("a hash-only move stays on the route, so the guard never asks", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mountDirtyAt(app, "/edit?tab=a");
    try {
      app._navigate?.("#notes");
      await settle();
      expect(getModal()).toBeNull();
      expect(href()).toBe("/edit?tab=a#notes");
      const route = app.live?.route as ParsedRoute;
      expect(route.query).toEqual({ tab: "a" });
      expect(route.hash).toEqual({ _tag: "Some", _0: "notes" });
    } finally {
      handle.dispose();
    }
  });

  it("a move to the path already shown stays on the route, so the guard never asks", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mountDirtyAt(app, "/edit");
    try {
      app._navigate?.("/edit");
      await settle();
      expect(getModal()).toBeNull();
      expect(href()).toBe("/edit");
      expect(app.live?.dirty).toBe(true);
    } finally {
      handle.dispose();
    }
  });
});

describe("route.leave guard — No on a move within one pattern", () => {
  it("puts back the old URL whole: path, query and hash", async () => {
    const app = leaveGuardApp("/todos/:id/edit") as Hooked;
    const handle = mountDirtyAt(app, "/todos/1/edit?tab=a#notes");
    try {
      app._navigate?.("/todos/2/edit");
      await settle();
      expect(getModal(), "a params-only move leaves todo 1").not.toBeNull();
      expect(href()).toBe("/todos/2/edit");

      getModal()
        ?.querySelector<HTMLButtonElement>("button[data-kumiki-confirm-action='no']")
        ?.click();
      await Promise.resolve();

      expect(getModal()).toBeNull();
      expect(href()).toBe("/todos/1/edit?tab=a#notes");
      const route = app.live?.route as ParsedRoute;
      expect(route.params).toEqual({ id: "1" });
      expect(route.query).toEqual({ tab: "a" });
      expect(route.hash).toEqual({ _tag: "Some", _0: "notes" });
    } finally {
      handle.dispose();
    }
  });
});
