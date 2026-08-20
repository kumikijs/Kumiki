// Issue #86 — runtime coverage for routing UX:
//   - `link` prefetch fires the named reducer on viewport entry (falling back
//     to a microtask dispatch in DOMs without IntersectionObserver, so smoke
//     and scenarios can observe the call deterministically).
//   - `tile T scroll-restoration = false` skips both forward scrollTo(0,0) and
//     popstate restore; standard tiles still receive scroll-to-top on push.
//   - `emit scroll-to({x,y})` reaches `window.scrollTo(x, y)`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const features = join(here, "..", "examples", "features");

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("issue #86 — link prefetch", () => {
  // The observer this runs against is the harness double, installed for every
  // file in this suite and by `kumiki smoke` alike — happy-dom's own
  // `observe()` is a no-op, so before it this path was unreachable from both
  // headless tiers and each test that wanted it built its own fake.
  it("dispatches the named reducer with $route.params on viewport entry", async () => {
    const app = await loadApp(join(features, "41-link-prefetch.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    // Allow the synchronous IO callback's reducer dispatch + re-render to settle.
    await new Promise((r) => setTimeout(r, 0));
    // The reducer reads `$route.params.get-or("id", "")` — spec §3.8 says the
    // prefetch binding matches `route.enter`, so `prefetch-args` must surface
    // as the route's `params`.
    expect(app.live?.prefetched).toBe(1);
    expect(app.live?.lastId).toBe("abc-123");
    expect(root.textContent).toContain("prefetched: 1");
    expect(root.textContent).toContain("lastId: abc-123");
  });

  // The other branch of `typeof IntersectionObserver === "function"`. A DOM
  // without one has to prefetch on a microtask instead, and that fallback is
  // only reachable when the global is genuinely absent.
  it("falls back to a microtask where there is no IntersectionObserver", async () => {
    const g = globalThis as {
      IntersectionObserver?: typeof IntersectionObserver | undefined;
    };
    const original = g.IntersectionObserver;
    // Absent, not present-and-undefined: the branch under test is
    // `typeof IntersectionObserver === "function"`, and only a real deletion
    // reproduces a DOM that never had one.
    delete g.IntersectionObserver;
    try {
      const app = await loadApp(join(features, "41-link-prefetch.kumiki"));
      const root = freshRoot();
      mount(app, root, { router: "memory" });
      await new Promise((r) => setTimeout(r, 0));
      expect(app.live?.prefetched).toBe(1);
      expect(app.live?.lastId).toBe("abc-123");
    } finally {
      if (original) g.IntersectionObserver = original;
    }
  });
});

describe("issue #86 — scroll restoration", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // happy-dom's window.scrollTo is a no-op; spy on it so we can assert the
    // runtime's calls without relying on a real layout viewport.
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  it("emits scroll-to({0,0}) from a reducer and routes it to window.scrollTo", async () => {
    const app = await loadApp(join(features, "42-scroll-restoration.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    // `route.enter("/")` fires `emit scroll-to({x:0, y:0})` on mount, which the
    // runtime's `scroll-to` effect dispatches to `window.scrollTo(0, 0)`.
    await new Promise((r) => setTimeout(r, 0));
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("auto-scrolls to (0,0) on a push-style navigation into a standard tile", async () => {
    // Uses 41 because all of its tiles take the default scroll-restoration;
    // the navigation from `/` to `/todos/:id` is therefore the exact path the
    // runtime's push hook (`updateRoute` → `applyScrollFor`) must service.
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

    // Navigate to /chat — Chat opts out of scroll-restoration. The push hook
    // must therefore NOT call window.scrollTo for this transition.
    (app as typeof app & { _navigate: (path: string, replace?: boolean) => void })._navigate(
      "/chat",
      false,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
