import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppShape, MountedApp, ParsedRoute } from "../src/core.ts";
import { mount } from "../src/index.ts";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

type Hooked = Partial<MountedApp> & AppShape;

let target: HTMLElement;
beforeEach(() => {
  target = freshRoot();
});
afterEach(() => {
  target.remove();
  for (const m of Array.from(document.querySelectorAll("[data-kumiki-confirm]"))) m.remove();
});

function leaveGuardApp(editPattern = "/edit"): AppShape {
  const app: AppShape = {
    slots: {
      dirty: { value: false },
      saved: { value: 0 },
      visits: { value: 0 },
      abouts: { value: 0 },
      stays: { value: 0 },
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
        name: "onEnterAbout",
        event: { kind: "lifecycle", name: 'route.enter("/about")' },
        apply: (slots) => ({
          slots: { ...slots, abouts: (slots.abouts as number) + 1 },
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
        apply: (slots) => ({
          slots: { ...slots, stays: (slots.stays as number) + 1 },
          emits: [],
        }),
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
        pattern: "/about",
        tile: () => ({ kind: "page", children: [{ kind: "heading", text: "About" }] }),
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
    const app = bareApp({ caps: ["notification.show"], routes: [] });
    const handle = mount(app, target);
    expect(app.effects.confirm).toBeDefined();
    expect(app.effects.confirm?.cap).toBe("notification.show");
    handle.dispose();
  });
});

describe("route.leave guard with confirm — Yes commits the transition", () => {
  it("holds nav until Yes, then commits + fires onYes reducer + route.enter", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      app._dispatch?.("edit", {});
      expect(app.live?.dirty).toBe(true);
      expect(getModal()).toBeNull();

      app._navigate?.("/");
      await Promise.resolve();
      await Promise.resolve();
      const modal = getModal();
      expect(modal, "confirm modal must appear").not.toBeNull();
      expect(target.textContent).toContain("Editor");
      expect(target.textContent).not.toContain("Home");

      // continueLeave runs first, then the held transition commits.
      const yes = modal?.querySelector<HTMLButtonElement>(
        "button[data-kumiki-confirm-action='yes']",
      );
      yes?.click();
      await Promise.resolve();

      expect(getModal()).toBeNull();
      expect(app.live?.dirty).toBe(false);
      expect(target.textContent).toContain("Home");
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
      expect(app.live?.stays).toBe(1);
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

describe("route.leave guard — what counts as leaving", () => {
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

function answer(outcome: "yes" | "no"): void {
  getModal()
    ?.querySelector<HTMLButtonElement>(`button[data-kumiki-confirm-action='${outcome}']`)
    ?.click();
}

describe("route.leave guard beside a notification.show provider", () => {
  it("asks through the built-in modal; the provider is handed nothing", async () => {
    const seen: unknown[] = [];
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, {
      router: "memory",
      initialPath: "/edit",
      providers: {
        "notification.show": (input) => {
          seen.push(input);
          return { kind: "ok", value: null };
        },
      },
    });
    try {
      app._dispatch?.("edit", {});
      app._navigate?.("/");
      await settle();
      expect(seen).toEqual([]);
      answer("yes");
      await Promise.resolve();
      expect(target.textContent).toContain("Home");
      expect(app.live?.visits).toBe(1);
    } finally {
      handle.dispose();
    }
  });
});

describe("route.leave guard — a navigation while a move is held", () => {
  it("replaces the held move: its modal closes unanswered and the guard asks again", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      app._dispatch?.("edit", {});
      app._navigate?.("/");
      await settle();
      const held = getModal();
      expect(held).not.toBeNull();

      app._navigate?.("/about");
      await settle();
      expect(held?.isConnected).toBe(false);
      expect(document.querySelectorAll("[data-kumiki-confirm]")).toHaveLength(1);
      // Closing it answered nothing: neither reducer ran.
      expect(app.live?.stays).toBe(0);
      expect(app.live?.dirty).toBe(true);
      expect(target.textContent).toContain("Editor");

      answer("yes");
      await Promise.resolve();
      expect((app.live?.route as ParsedRoute).path).toBe("/about");
      expect(app.live?.abouts).toBe(1);
      expect(app.live?.visits).toBe(0);
    } finally {
      handle.dispose();
    }
  });

  it("is replaced by a navigation the answer's reducer emits, which the answer then leaves be", async () => {
    const app = leaveGuardApp() as Hooked;
    app.caps.push("nav.push");
    const stayHere = app.reducers.find((r) => r.name === "stayHere");
    if (!stayHere) throw new Error("no stayHere");
    // No that goes somewhere else instead, edits still unsaved.
    stayHere.apply = (slots) => ({
      slots,
      emits: [{ effect: "navigate", args: [{ path: "/about" }] }],
    });
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      app._dispatch?.("edit", {});
      app._navigate?.("/");
      await settle();
      answer("no");
      await settle();
      // The guard asked about /about, and No on the first move reverted nothing.
      expect(document.querySelectorAll("[data-kumiki-confirm]")).toHaveLength(1);
      expect(target.textContent).toContain("Editor");

      answer("yes");
      await Promise.resolve();
      expect((app.live?.route as ParsedRoute).path).toBe("/about");
      expect(app.live?.abouts).toBe(1);
    } finally {
      handle.dispose();
    }
  });

  it("is settled only by the guard's modal, not by one another reducer opens", async () => {
    const app = leaveGuardApp() as Hooked;
    app.reducers.push({
      name: "askOther",
      event: { kind: "ui", ev: "click" },
      apply: (slots) => ({
        slots,
        emits: [{ effect: "confirm", args: [{ title: "Other?", onYes: "stayHere" }] }],
      }),
    });
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      app._dispatch?.("edit", {});
      app._navigate?.("/");
      await settle();
      app._dispatch?.("askOther", {});
      await settle();
      const [guardModal, other] = Array.from(
        document.querySelectorAll<HTMLElement>("[data-kumiki-confirm]"),
      );
      other?.querySelector<HTMLButtonElement>("button[data-kumiki-confirm-action='yes']")?.click();
      await Promise.resolve();
      expect(app.live?.stays).toBe(1);
      expect(target.textContent).toContain("Editor");
      expect(guardModal?.isConnected).toBe(true);

      answer("yes");
      await Promise.resolve();
      expect(target.textContent).toContain("Home");
    } finally {
      handle.dispose();
    }
  });

  it("gives way to the next navigation when its confirm never answers", async () => {
    const app = leaveGuardApp() as Hooked;
    const handle = mount(app, target, { router: "memory", initialPath: "/edit" });
    try {
      // A confirm that settles without opening a modal, so no answer arrives.
      const asked: unknown[] = [];
      app.effects.confirm = {
        name: "confirm",
        cap: "notification.show",
        invoke: async (input) => {
          asked.push(input);
          return { kind: "ok", value: null };
        },
      };
      app._dispatch?.("edit", {});
      app._navigate?.("/");
      await settle();
      expect(asked).toHaveLength(1);
      expect(target.textContent).toContain("Editor");

      // The next navigation is not swallowed: the guard runs for it…
      app._navigate?.("/about");
      await settle();
      expect(asked).toHaveLength(2);

      // …and with nothing left to ask, the move completes.
      app._dispatch?.("save", {});
      app._navigate?.("/");
      await settle();
      expect(target.textContent).toContain("Home");
      expect(app.live?.visits).toBe(1);
    } finally {
      handle.dispose();
    }
  });
});
