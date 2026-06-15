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
  // happy-dom ships a stub `IntersectionObserver` whose `observe()` is a no-op
  // (TODO upstream). Swap in a fake that synchronously fires for the observed
  // target so the runtime's primary path — IO entry → reducer dispatch — gets
  // exercised in CI. The fake is restored after each test.
  let originalIO: typeof globalThis.IntersectionObserver | undefined;

  beforeEach(() => {
    originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    class FakeIO {
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element): void {
        // Fire as if `target` is already in the viewport, but on a microtask so
        // we don't re-enter render() before the runtime returns from observe().
        queueMicrotask(() => {
          const entry = { isIntersecting: true, target } as IntersectionObserverEntry;
          this.cb([entry], this as unknown as IntersectionObserver);
        });
      }
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      FakeIO as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIO;
  });

  it("dispatches the named reducer with prefetch-args on viewport entry", async () => {
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

  it("emits scroll-to and scrolls to top on a push-style navigation", async () => {
    const app = await loadApp(join(features, "42-scroll-restoration.kumiki"));
    const root = freshRoot();
    mount(app, root, { router: "memory" });
    // `route.enter("/")` fires `emit scroll-to({x:0, y:0})` on mount.
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
