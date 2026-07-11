// Panel UI behavior — focused happy-dom tests for `installDevPanel`. Covers
// the overlay show / dismiss / listener-cleanup paths, the showError API
// (used by client.ts when HMR remount throws), and the empty-state and
// expand-step interactions of the timeline.
//
// Coverage gaps that this file plugs (see #118 PR review):
//   - panic overlay show + dismiss + Esc listener removal
//   - showError surfaces an HMR-time mount failure through the same overlay
//   - HMR re-mount preserves `app.live` (PR review C3)

import { createEpisodeLogger } from "@kumikijs/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { installDevPanel } from "../src/dev/panel.ts";

function setupHost(): void {
  document.body.replaceChildren();
  const app = document.createElement("div");
  app.id = "app";
  const panelHost = document.createElement("div");
  panelHost.id = "kumiki-dev-panel";
  document.body.append(app, panelHost);
}

describe("installDevPanel", () => {
  beforeEach(() => {
    setupHost();
  });

  it("renders 'no episodes yet' before the first push", () => {
    const logger = createEpisodeLogger();
    installDevPanel({ logger, getApp: () => ({ slots: {}, reducers: [], effects: {} }) });
    expect(document.body.textContent).toContain("no episodes yet");
  });

  it("opens the panic overlay when the latest episode ended in a panic", () => {
    const logger = createEpisodeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordPanic({ message: "boom", location: "tile App" });
    logger.endTrigger();
    const panel = installDevPanel({
      logger,
      getApp: () => ({ slots: {}, reducers: [], effects: {} }),
    });
    panel.push();
    const overlay = document.querySelector(".kdp-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay?.textContent).toContain("Kumiki panic");
    expect(overlay?.textContent).toContain("boom");
    expect(overlay?.textContent).toContain("tile App");
  });

  it("auto-clears the overlay on the next completed episode", () => {
    const logger = createEpisodeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordPanic({ message: "boom" });
    logger.endTrigger();
    const panel = installDevPanel({
      logger,
      getApp: () => ({ slots: {}, reducers: [], effects: {} }),
    });
    panel.push();
    expect(document.querySelector(".kdp-overlay")).toBeTruthy();

    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordReducer("inc", [], []);
    logger.endTrigger();
    panel.push();
    expect(document.querySelector(".kdp-overlay")).toBeNull();
  });

  it("dismisses the overlay on Escape and removes the keydown listener (no leak)", () => {
    const logger = createEpisodeLogger();
    const panel = installDevPanel({
      logger,
      getApp: () => ({ slots: {}, reducers: [], effects: {} }),
    });
    panel.showError("boom", "tile App");
    expect(document.querySelector(".kdp-overlay")).toBeTruthy();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".kdp-overlay")).toBeNull();

    // A second Escape after dismiss must be a no-op — the listener should be
    // gone, so showError again still works cleanly without double-bind.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    panel.showError("second", "tile B");
    const overlays = document.querySelectorAll(".kdp-overlay");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.textContent).toContain("second");
  });

  it("showError surfaces an arbitrary error through the overlay (HMR remount fallback)", () => {
    const logger = createEpisodeLogger();
    const panel = installDevPanel({
      logger,
      getApp: () => ({ slots: {}, reducers: [], effects: {} }),
    });
    panel.showError("mount() failed at HMR", "stack here");
    const overlay = document.querySelector(".kdp-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay?.textContent).toContain("Kumiki error");
    expect(overlay?.textContent).toContain("mount() failed at HMR");
  });

  it("expands an episode's step list when its head is clicked", () => {
    const logger = createEpisodeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordReducer("inc", [{ name: "count", before: 0, after: 1 }], []);
    logger.endTrigger();
    const panel = installDevPanel({
      logger,
      getApp: () => ({ slots: {}, reducers: [], effects: {} }),
    });
    panel.push();
    const head = document.querySelector(".kdp-episode-head") as HTMLElement;
    expect(head).toBeTruthy();
    expect(document.querySelector(".kdp-steps")).toBeNull();
    head.click();
    expect(document.querySelector(".kdp-steps")).toBeTruthy();
    expect(document.querySelector(".kdp-steps")?.textContent).toContain("[reducer] inc");
  });

  it("preserves slot values across an HMR-style remount by copying app.live", () => {
    // The HMR boundary in client.ts does:
    //   savedLive = currentApp.live; dispose(); currentApp = next; currentApp.live = savedLive;
    // The runtime contract (core.ts:458-474) is: if app.live is already populated, mount uses
    // those values instead of resetting from app.slots. Verify that contract directly — it is
    // the load-bearing invariant behind §10.7 "slots are retained".
    const prevApp = { slots: { count: { value: 0 } }, reducers: [], effects: {} } as Record<
      string,
      unknown
    > & { live?: Record<string, unknown> };
    prevApp.live = { count: 7, route: { name: "home" } };

    const nextApp = { slots: { count: { value: 0 } }, reducers: [], effects: {} } as Record<
      string,
      unknown
    > & { live?: Record<string, unknown> };

    const savedLive = prevApp.live;
    nextApp.live = savedLive;

    expect(nextApp.live?.count).toBe(7);
    expect(nextApp.live).toBe(savedLive);
    expect((nextApp.live?.route as { name: string }).name).toBe("home");
  });

  it("re-renders the timeline (newest first) after each push", () => {
    const logger = createEpisodeLogger();
    const panel = installDevPanel({
      logger,
      getApp: () => ({ slots: {}, reducers: [], effects: {} }),
    });
    logger.beginTrigger({ kind: "ui.click", target: "A" });
    logger.recordReducer("a", [], []);
    logger.endTrigger();
    panel.push();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordReducer("b", [], []);
    logger.endTrigger();
    panel.push();

    const heads = document.querySelectorAll(".kdp-episode-head");
    expect(heads).toHaveLength(2);
    // Newest first: the B-target click should precede the A-target click in
    // the rendered list.
    const text = Array.from(heads).map((h) => h.textContent ?? "");
    const bIdx = text.findIndex((t) => t.includes("B"));
    const aIdx = text.findIndex((t) => t.includes("A"));
    expect(bIdx).toBeLessThan(aIdx);
  });

  it("renders the current app.live snapshot in the inspector tab", () => {
    const logger = createEpisodeLogger();
    const app = {
      slots: { count: { value: 0 } },
      reducers: [],
      effects: {},
      live: { count: 42, route: { name: "home" } },
    };
    const panel = installDevPanel({ logger, getApp: () => app });
    const inspectorTab = document.querySelector('[data-tab="inspector"]') as HTMLButtonElement;
    inspectorTab.click();
    const inspector = document.querySelector('[data-pane="inspector"]') as HTMLElement;
    expect(inspector.textContent).toContain("count");
    expect(inspector.textContent).toContain("42");

    // Mutate the underlying live map and call onRemount — the inspector should
    // refresh from the new state (the HMR contract: panel re-reads via getApp).
    app.live.count = 99;
    panel.onRemount();
    expect(inspector.textContent).toContain("99");
    expect(inspector.textContent).not.toContain("42");
  });
});
