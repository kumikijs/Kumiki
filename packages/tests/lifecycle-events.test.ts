// End-to-end coverage for the lifecycle events introduced in #81. The runtime
// must:
//   - wire window beforeunload / visibilitychange / online / offline to the
//     matching `app.*` reducers,
//   - diff the rendered tile tree each render and fire
//     `tile.mount(X)` / `tile.unmount(X)` for user-defined tiles, and
//   - dispatch `route.error("/p")` when rendering throws under route `/p`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE_EXAMPLE = join(here, "..", "examples", "features", "37-lifecycle-events.kumiki");

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

describe("lifecycle events (#81) — runtime wiring", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  it("fires tile.mount / tile.unmount as a user-defined tile enters / leaves the tree", async () => {
    const app = await loadApp(LIFECYCLE_EXAMPLE);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot);
    disposeFn = dispose;

    // Initial render mounts Home + ToggleBtn but not Panel.
    const live = app.live as Record<string, unknown>;
    expect(live.mounts).toBe(0);
    expect(live.unmounts).toBe(0);

    // Flip the slot through the host-exposed setter so the assertion does not
    // depend on which specific DOM button receives the click.
    const setSlot = (app as AppShape & { _setSlot?: (n: string, v: unknown) => void })._setSlot;
    if (!setSlot) throw new Error("runtime did not expose _setSlot");
    setSlot("panelOn", true);
    await tick();
    expect(live.mounts).toBe(1);
    expect(live.unmounts).toBe(0);

    setSlot("panelOn", false);
    await tick();
    expect(live.mounts).toBe(1);
    expect(live.unmounts).toBe(1);
  });

  it("fires app.online / app.offline on the corresponding window events", async () => {
    const app = await loadApp(LIFECYCLE_EXAMPLE);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot);
    disposeFn = dispose;

    const live = app.live as Record<string, unknown>;
    expect(live.online).toBe(true);
    window.dispatchEvent(new Event("offline"));
    expect(live.online).toBe(false);
    window.dispatchEvent(new Event("online"));
    expect(live.online).toBe(true);
  });

  it("fires app.visible / app.hidden on visibilitychange", async () => {
    const app = await loadApp(LIFECYCLE_EXAMPLE);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot);
    disposeFn = dispose;
    const live = app.live as Record<string, unknown>;

    // happy-dom does not flip visibilityState for us — override the getter
    // (configurable in happy-dom) and fire the event the runtime listens for.
    const restoreHidden = stubVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(live.visible).toBe(false);
    restoreHidden();

    const restoreVisible = stubVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(live.visible).toBe(true);
    restoreVisible();
  });

  it("fires app.stop on beforeunload", async () => {
    const app = await loadApp(LIFECYCLE_EXAMPLE);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot);
    disposeFn = dispose;
    const live = app.live as Record<string, unknown>;
    expect(live.stops).toBe(0);
    window.dispatchEvent(new Event("beforeunload"));
    expect(live.stops).toBe(1);
  });

  it("removes window listeners on dispose", async () => {
    const app = await loadApp(LIFECYCLE_EXAMPLE);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot);
    const live = app.live as Record<string, unknown>;
    dispose();
    disposeFn = undefined;
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("beforeunload"));
    // listeners gone → the slots stay at their post-mount values
    expect(live.online).toBe(true);
    expect(live.stops).toBe(0);
  });
});

function stubVisibility(state: "visible" | "hidden"): () => void {
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  return () => {
    if (desc) Object.defineProperty(document, "visibilityState", desc);
    else
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
  };
}
