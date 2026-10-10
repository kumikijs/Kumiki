import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { mountApp, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const LIFECYCLE_EXAMPLE = feature("37-lifecycle-events");

describe("lifecycle events — runtime wiring", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  /** Mount the example; `afterEach` disposes it unless the test already did. */
  async function mounted(): Promise<{ app: AppShape; dispose: () => void }> {
    const app = await loadApp(LIFECYCLE_EXAMPLE);
    const { root, handle } = mountApp(app);
    mountedRoot = root;
    disposeFn = () => handle.dispose();
    return {
      app,
      dispose: () => {
        handle.dispose();
        disposeFn = undefined;
      },
    };
  }

  it("fires tile.mount / tile.unmount as a user-defined tile enters / leaves the tree", async () => {
    const { app } = await mounted();

    // Initial render mounts Home + ToggleBtn but not Panel.
    const live = app.live as Record<string, unknown>;
    expect(live.mounts).toBe(0);
    expect(live.unmounts).toBe(0);

    // Flip the slot through the host-exposed setter so the assertion does not depend on which specific DOM button receives the click.
    const setSlot = (app as AppShape & { _setSlot?: (n: string, v: unknown) => void })._setSlot;
    if (!setSlot) throw new Error("runtime did not expose _setSlot");
    setSlot("panelOn", true);
    await tick(0);
    expect(live.mounts).toBe(1);
    expect(live.unmounts).toBe(0);

    setSlot("panelOn", false);
    await tick(0);
    expect(live.mounts).toBe(1);
    expect(live.unmounts).toBe(1);
  });

  it("fires app.online / app.offline on the corresponding window events", async () => {
    const { app } = await mounted();
    const live = app.live as Record<string, unknown>;
    expect(live.online).toBe(true);
    window.dispatchEvent(new Event("offline"));
    expect(live.online).toBe(false);
    window.dispatchEvent(new Event("online"));
    expect(live.online).toBe(true);
  });

  it("fires app.visible / app.hidden on visibilitychange", async () => {
    const { app } = await mounted();
    const live = app.live as Record<string, unknown>;

    // happy-dom does not flip visibilityState for us — override the getter (configurable in happy-dom) and fire the event the runtime listens for.
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
    const { app } = await mounted();
    const live = app.live as Record<string, unknown>;
    expect(live.stops).toBe(0);
    window.dispatchEvent(new Event("beforeunload"));
    expect(live.stops).toBe(1);
  });

  it("removes window listeners on dispose", async () => {
    const { app, dispose } = await mounted();
    const live = app.live as Record<string, unknown>;
    dispose();
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("beforeunload"));
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
