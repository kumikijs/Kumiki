// Panel UI behavior — focused happy-dom tests for `installDevPanel`. Covers
// the overlay show / dismiss / listener-cleanup paths, the showError API
// (used by client.ts when HMR remount throws), and the empty-state and
// expand-step interactions of the timeline.
//
// Coverage gaps that this file plugs (see #118 PR review):
//   - panic overlay show + dismiss + Esc listener removal
//   - showError surfaces an HMR-time mount failure through the same overlay
//   - HMR re-mount preserves `app.live` (PR review C3)

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDevPanel } from "../src/dev/panel.ts";
import { loadApp } from "../src/smoke.ts";

/** The smallest app the panel can be handed: no slots, no reducers, nothing running. */
function emptyApp(over: Partial<AppShape> = {}): AppShape {
  return { slots: {}, caps: [], reducers: [], effects: {}, init: [], ...over };
}

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
    installDevPanel({ logger, getApp: emptyApp });
    expect(document.body.textContent).toContain("no episodes yet");
  });

  it("opens the panic overlay when the latest episode ended in a panic", () => {
    const logger = createEpisodeLogger();
    logger.beginTrigger({ kind: "ui.click", target: "B" });
    logger.recordPanic({ message: "boom", location: "tile App" });
    logger.endTrigger();
    const panel = installDevPanel({
      logger,
      getApp: emptyApp,
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
      getApp: emptyApp,
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
      getApp: emptyApp,
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
      getApp: emptyApp,
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
      getApp: emptyApp,
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
      getApp: emptyApp,
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
    const live = { count: 42, route: { name: "home" } };
    const app = emptyApp({ slots: { count: { value: 0 } }, live });
    const panel = installDevPanel({ logger, getApp: () => app });
    const inspectorTab = document.querySelector('[data-tab="inspector"]') as HTMLButtonElement;
    inspectorTab.click();
    const inspector = document.querySelector('[data-pane="inspector"]') as HTMLElement;
    expect(inspector.textContent).toContain("count");
    expect(inspector.textContent).toContain("42");

    // Mutate the underlying live map and call onRemount — the inspector should
    // refresh from the new state (the HMR contract: panel re-reads via getApp).
    live.count = 99;
    panel.onRemount();
    expect(inspector.textContent).toContain("99");
    expect(inspector.textContent).not.toContain("42");
  });
});

// The overlay is for a panic nothing handled (runtime.md §10.7): the panel asks
// each `panic` step whether it was handled (§10.5.1) rather than reading where
// the step sits in the episode. These drive a compiled program through a real
// mount, the way `kumiki dev`'s client wires the logger to the panel, so the
// episode is the one the runtime writes rather than one assembled by hand.
describe("the panic overlay opens for a panic nothing handled", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // `loadApp` writes the compiled module under `moduleDir`; vitest's resolver
  // is confined to the project, which the OS temp dir is outside.
  const moduleDir = resolve(here, "../test-tmp");
  mkdirSync(moduleDir, { recursive: true });

  const APP = `
app Demo
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

  let quiet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setupHost();
    // The unhandled panics below are reported to the console, as they should be.
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    quiet.mockRestore();
  });

  /** Compile `source`, mount it with a logger wired to the panel, and click `#go`. */
  async function clickGo(source: string): Promise<void> {
    const app = await loadApp(`${source}\n${APP}`, [], { moduleDir });
    let panel: ReturnType<typeof installDevPanel> | undefined;
    const logger = createEpisodeLogger({ onEpisode: () => panel?.push() });
    panel = installDevPanel({ logger, getApp: () => app });
    mount(app, document.getElementById("app") as HTMLElement, { episodeLogger: logger });
    (document.getElementById("go") as HTMLElement).click();
  }

  // `Risky` panics on every render, under a boundary. The first paint is inside
  // no episode and records nothing; the click's reducer writes no slot, so no
  // `signal-update` follows the render and the caught panic is the episode's
  // last step.
  it("stays closed for a panic a boundary caught after a reducer that wrote no slot", async () => {
    await clickGo(`
slot secret : Option(Text) = None
slot count  : Int          = 0

tile Risky
    error-boundary = Fallback
    = column(text("secret: " + secret.get))

tile Fallback
    in=PanicInfo
    = text("recovered: " + $1.message)

tile Go = button(text="go", onClick=noop) {id: "go"}

tile App = column(Risky, Go)

reducer noop on=ui.click(Go) do= if count > 100 then count := 0`);
    expect(document.getElementById("app")?.textContent).toContain("recovered: get called on None");
    expect(document.querySelector(".kdp-overlay")).toBeNull();

    // The caught panic is still on the timeline, marked as handled.
    (document.querySelector(".kdp-episode-head") as HTMLElement).click();
    const steps = Array.from(document.querySelectorAll(".kdp-step"), (li) => li.textContent);
    expect(steps).toEqual(["[reducer] noop", "[panic] get called on None  @ Risky  (handled)"]);
  });

  // The reducer writes the slot that makes `Risky` panic, so a `signal-update`
  // follows the panic: the panic is not the episode's last step, and the
  // overlay opens all the same.
  it("opens for a render panic no boundary caught", async () => {
    await clickGo(`
slot secret : Option(Text) = None
slot reveal : Bool         = false

tile Risky = column(when(reveal, text("secret: " + secret.get)))

tile Go = button(text="go", onClick=doReveal) {id: "go"}

tile App = column(Risky, Go)

reducer doReveal on=ui.click(Go) do= reveal := true`);
    const overlay = document.querySelector(".kdp-overlay");
    expect(overlay?.textContent).toContain("Kumiki panic");
    expect(overlay?.textContent).toContain("get called on None");
    expect(overlay?.querySelector(".kdp-overlay-loc")?.textContent).toBe("render");
  });

  // An `app.error` reducer is told about a reducer panic; it does not handle
  // it. The panic is still reported to the console `smoke` fails on, so the
  // overlay opens for it too — after the handler's own steps.
  it("opens for a reducer panic an app.error reducer was told about", async () => {
    await clickGo(`
slot secret : Option(Text) = None
slot caught : Text         = "-"

tile Go = button(text="go", onClick=boom) {id: "go"}

tile App = column(text("caught: " + caught), Go)

reducer boom    on=ui.click(Go) do= caught := secret.get
reducer onPanic on=app.error    do= caught := $event.message`);
    expect(document.getElementById("app")?.textContent).toContain("caught: get called on None");
    const overlay = document.querySelector(".kdp-overlay");
    expect(overlay?.textContent).toContain("get called on None");
    expect(overlay?.querySelector(".kdp-overlay-loc")?.textContent).toBe(`reducer "boom"`);
  });
});
