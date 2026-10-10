import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp, navigate, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const PREFETCH = feature("41-link-prefetch");
const SCROLL = feature("42-scroll-restoration");

/** Mount `file` under a memory router and let the mount's own reducers run. */
async function mounted(file: string): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadApp(file);
  const { root } = mountApp(app, { router: "memory" });
  await tick(0);
  return { app, root };
}

describe("link prefetch", () => {
  it("dispatches the named reducer with $route.params on viewport entry", async () => {
    const { app, root } = await mounted(PREFETCH);
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
      const { app } = await mounted(PREFETCH);
      expect(app.live?.prefetched).toBe(1);
      expect(app.live?.lastId).toBe("abc-123");
    } finally {
      if (original) g.IntersectionObserver = original;
    }
  });
});

describe("scroll restoration", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // happy-dom does not scroll, so the runtime's calls are the observable.
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  it("routes a reducer's scroll-to({0,0}) to window.scrollTo", async () => {
    await mounted(SCROLL);
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("auto-scrolls to (0,0) on a push-style navigation into a standard tile", async () => {
    const { app } = await mounted(PREFETCH);
    scrollSpy.mockClear();
    await navigate(app, "/todos/abc-123");
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("skips automatic scroll on a tile with scroll-restoration = false", async () => {
    const { app } = await mounted(SCROLL);
    scrollSpy.mockClear();
    await navigate(app, "/chat");
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
