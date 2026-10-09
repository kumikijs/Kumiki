import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { createEpisodeLogger, hydrate, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.js";

function resetLive(app: AppShape): void {
  delete app.live;
}

const here = dirname(fileURLToPath(import.meta.url));
const ssrAppPath = join(here, "..", "examples", "apps", "10-ssr-hydration", "app.kumiki");

describe("SSR hydration integration (issue#119)", () => {
  it("renders HTML, ships a snapshot, and hydrates onto a fresh DOM root", async () => {
    const app = await loadApp(ssrAppPath);

    const httpProvider = vi.fn(async () => ({
      kind: "ok" as const,
      value: { id: "u_1", name: "Yui" },
    }));
    const rendered = await renderToString(app, {
      providers: { "http.get": httpProvider },
    });

    expect(httpProvider).toHaveBeenCalledTimes(1);
    expect(rendered.snapshot.kumiki).toBe(1);
    expect(rendered.snapshot.route).toBe("/");
    expect(rendered.snapshot.slots.user).toEqual({ id: "u_1", name: "Yui" });
    expect(rendered.snapshot.slots).not.toHaveProperty("draft");

    expect(rendered.html).toContain("Hi Yui");

    resetLive(app);
    const target = document.createElement("div");
    target.innerHTML = rendered.html;
    document.body.appendChild(target);
    expect(target.children.length).toBeGreaterThanOrEqual(1);

    const logger = createEpisodeLogger();
    const handle = hydrate(app, target, rendered, {
      episodeLogger: logger,
      providers: { "http.get": httpProvider },
    });

    // Snapshot reached signal graph (compiled reducer reads from `app.live`).
    expect((app.live?.user as { name: string } | undefined)?.name).toBe("Yui");
    // Volatile slot stayed at its declared default.
    expect(app.live?.draft).toBe("");
    // `app.init` did NOT re-run on the client (provider stays at 1 call).
    expect(httpProvider).toHaveBeenCalledTimes(1);

    const eps = handle.episodes();
    expect(eps[0]?.trigger.kind).toBe("ssr.hydrate");
    expect(eps[0]?.id).toBe(rendered.bootstrapEpisode.id);
    // app.start has no user-declared lifecycle reducer in this fixture, so the next observable episode comes from user input (or stays absent).
    expect(eps[0]?.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "effect-end",
      "reducer",
      "signal-update",
    ]);

    expect(target.children.length).toBe(1);
    const button = target.querySelector("button");
    expect(button).not.toBeNull();
    (button as HTMLButtonElement).click();

    const afterClick = handle.episodes();
    const triggerKinds = afterClick.map((e) => e.trigger.kind);
    expect(triggerKinds[0]).toBe("ssr.hydrate");
    expect(triggerKinds).toContain("ui.click");
    const clickIdx = triggerKinds.indexOf("ui.click");
    expect(clickIdx).toBeGreaterThan(0);
    expect(app.live?.count).toBe(1);

    handle.dispose();
    target.remove();
  });
});

describe("the served page carries what the client paints", () => {
  it("serves a markdown body as paragraphs and a closed surface as a hidden host", async () => {
    const app = await loadSource(`
slot shown : Bool = false

tile Notes  = markdown("first line\\nsecond line\\n\\nnew paragraph")
tile Dialog = modal(text("dialog body"), open=shown, title="Details")
tile App    = column(Notes, Dialog)

app SsrParity
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const { html } = await renderToString(app);
    const host = document.createElement("div");
    host.innerHTML = html;

    const paras = host.querySelectorAll('[data-kumiki-tile="markdown"] p');
    expect(Array.from(paras).map((p) => p.textContent)).toEqual([
      "first line\nsecond line",
      "new paragraph",
    ]);

    const dialog = host.querySelector('[data-kumiki-tile="modal"]');
    expect(dialog?.getAttribute("style")).toContain("display: none");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Details");
    expect(dialog?.textContent).toContain("dialog body");
  });
});
