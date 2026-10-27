import type { AppShape } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDevPanel } from "../src/dev/panel.ts";
import { buildAndLoad } from "./helpers/build-and-load.ts";
import { APP_A, seed } from "./helpers/files.ts";

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

    live.count = 99;
    panel.onRemount();
    expect(inspector.textContent).toContain("99");
    expect(inspector.textContent).not.toContain("42");
  });
});

describe("the panic overlay opens for a panic nothing handled", () => {
  let quiet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setupHost();
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    quiet.mockRestore();
  });

  /** Compile `source`, mount it with a logger wired to the panel, as `kumiki dev`'s client does, and click `#go`. */
  async function clickGo(source: string): Promise<void> {
    const app = await buildAndLoad(seed(`${source}\n${APP_A}`), "app");
    let panel: ReturnType<typeof installDevPanel> | undefined;
    const logger = createEpisodeLogger({ onEpisode: () => panel?.push() });
    panel = installDevPanel({ logger, getApp: () => app });
    mount(app, document.getElementById("app") as HTMLElement, { episodeLogger: logger });
    (document.getElementById("go") as HTMLElement).click();
  }

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

    (document.querySelector(".kdp-episode-head") as HTMLElement).click();
    const steps = Array.from(document.querySelectorAll(".kdp-step"), (li) => li.textContent);
    expect(steps).toEqual(["[reducer] noop", "[panic] get called on None  @ Risky  (handled)"]);
  });

  it.each([
    {
      name: "a render panic no boundary caught, with a signal-update after it",
      source: `
slot secret : Option(Text) = None
slot reveal : Bool         = false

tile Risky = column(when(reveal, text("secret: " + secret.get)))

tile Go = button(text="go", onClick=doReveal) {id: "go"}

tile App = column(Risky, Go)

reducer doReveal on=ui.click(Go) do= reveal := true`,
      location: "render",
    },
    {
      name: "a reducer panic an app.error reducer was told about",
      source: `
slot secret : Option(Text) = None
slot caught : Text         = "-"

tile Go = button(text="go", onClick=boom) {id: "go"}

tile App = column(text("caught: " + caught), Go)

reducer boom    on=ui.click(Go) do= caught := secret.get
reducer onPanic on=app.error    do= caught := $event.message`,
      location: `reducer "boom"`,
    },
  ])("opens for $name", async ({ source, location }) => {
    await clickGo(source);
    const overlay = document.querySelector(".kdp-overlay");
    expect(overlay?.textContent).toContain("Kumiki panic");
    expect(overlay?.textContent).toContain("get called on None");
    expect(overlay?.querySelector(".kdp-overlay-loc")?.textContent).toBe(location);
  });
});
