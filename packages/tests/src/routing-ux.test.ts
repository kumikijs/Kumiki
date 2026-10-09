import { join } from "node:path";
import { featuresDir } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const features = featuresDir;

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("link prefetch", () => {
  it("dispatches the named reducer with $route.params on viewport entry", async () => {
    const app = await loadApp(join(features, "41-link-prefetch.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    // Allow the synchronous IO callback's reducer dispatch + re-render to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(app.live?.prefetched).toBe(1);
    expect(app.live?.lastId).toBe("abc-123");
    expect(root.textContent).toContain("prefetched: 1");
    expect(root.textContent).toContain("lastId: abc-123");
  });

  it("falls back to a microtask where there is no IntersectionObserver", async () => {
    const g = globalThis as {
      IntersectionObserver?: typeof IntersectionObserver | undefined;
    };
    const original = g.IntersectionObserver;
    delete g.IntersectionObserver;
    try {
      const app = await loadApp(join(features, "41-link-prefetch.kumiki"));
      const root = freshRoot();
      mount(app, root, { router: "memory" });
      await new Promise((r) => setTimeout(r, 0));
      expect(app.live?.prefetched).toBe(1);
      expect(app.live?.lastId).toBe("abc-123");
    } finally {
      // Absent to begin with stays absent — the delete above already left it so.
      if (original) g.IntersectionObserver = original;
    }
  });
});

describe("scroll restoration", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // happy-dom's window.scrollTo is a no-op; spy on it so we can assert the runtime's calls without relying on a real layout viewport.
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  it("emits scroll-to({0,0}) from a reducer and routes it to window.scrollTo", async () => {
    const app = await loadApp(join(features, "42-scroll-restoration.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    // `route.enter("/")` fires `emit scroll-to({x:0, y:0})` on mount, which the runtime's `scroll-to` effect dispatches to `window.scrollTo(0, 0)`.
    await new Promise((r) => setTimeout(r, 0));
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("auto-scrolls to (0,0) on a push-style navigation into a standard tile", async () => {
    const app = await loadApp(join(features, "41-link-prefetch.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    await new Promise((r) => setTimeout(r, 0));
    scrollSpy.mockClear();

    (app as typeof app & { _navigate: (path: string, replace?: boolean) => void })._navigate(
      "/todos/abc-123",
      false,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("skips automatic scroll on a tile with scroll-restoration = false", async () => {
    const app = await loadApp(join(features, "42-scroll-restoration.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    await new Promise((r) => setTimeout(r, 0));
    scrollSpy.mockClear();

    (app as typeof app & { _navigate: (path: string, replace?: boolean) => void })._navigate(
      "/chat",
      false,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
