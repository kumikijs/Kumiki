import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

type Route = { pattern: string; params: Record<string, string>; hash: unknown };

const routeOf = (app: AppShape): Route => app.live?.route as Route;

function makeRoutedApp(): AppShape {
  const app = bareApp({
    caps: ["nav.push"],
    root: () => ({ kind: "text", text: "", props: {} }),
  });
  app.routes = [
    { pattern: "/", tile: () => ({ kind: "text", text: "home", props: {} }) },
    {
      pattern: "/items/:id",
      tile: () => ({ kind: "text", text: `item ${routeOf(app).params.id ?? "?"}`, props: {} }),
    },
    { pattern: "/404", tile: () => ({ kind: "text", text: "not found", props: {} }) },
  ];
  return app;
}

describe("memory router mode", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    root.remove();
  });

  const navigate = (app: AppShape, path: string): void => (app as MountedApp)._navigate(path);

  it("starts at the virtual initial path, not location.pathname", () => {
    const app = makeRoutedApp();
    const { dispose } = mount(app, root, { router: "memory", initialPath: "/items/99" });
    expect(root.textContent).toBe("item 99");
    expect(routeOf(app).pattern).toBe("/items/:id");
    dispose();
  });

  it("defaults to / and resolves a real route, not /404", () => {
    const { dispose } = mount(makeRoutedApp(), root, { router: "memory" });
    expect(root.textContent).toBe("home");
    dispose();
  });

  it("navigates through internal state, keeping path params, without touching history", () => {
    const pushSpy = vi.spyOn(history, "pushState");
    const app = makeRoutedApp();
    const { dispose } = mount(app, root, { router: "memory" });
    navigate(app, "/items/42");
    expect(root.textContent).toBe("item 42");
    expect(routeOf(app).params.id).toBe("42");
    expect(pushSpy).not.toHaveBeenCalled();
    dispose();
  });

  it("leaves history mode the default, driving the real history API", () => {
    const pushSpy = vi.spyOn(history, "pushState");
    const app = makeRoutedApp();
    const { dispose } = mount(app, root);
    navigate(app, "/items/7");
    expect(root.textContent).toBe("item 7");
    expect(pushSpy).toHaveBeenCalled();
    dispose();
    history.replaceState(null, "", "/");
  });

  it.each([
    ["/#section", { _tag: "Some", _0: "section" }],
    ["/", { _tag: "None" }],
  ])("reads route.hash at %s as the Option %j", (path, hash) => {
    const app = bareApp({
      slots: { route: { value: null } },
      routes: [{ pattern: "/", tile: () => ({ kind: "page", children: [] }) }],
    });
    const { dispose } = mount(app, root, { router: "memory", initialPath: path });
    expect(routeOf(app).hash).toEqual(hash);
    dispose();
  });
});
