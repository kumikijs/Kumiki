import { app as appExample } from "@kumikijs/examples";
import { createEpisodeLogger, hydrate, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

describe("SSR hydration", () => {
  it("renders HTML, ships a snapshot, and hydrates onto a fresh DOM root", async () => {
    const app = await loadApp(appExample("10-ssr-hydration"));

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

    Reflect.deleteProperty(app, "live");
    const target = freshRoot();
    target.innerHTML = rendered.html;
    expect(target.children.length).toBeGreaterThanOrEqual(1);

    const logger = createEpisodeLogger();
    const handle = hydrate(app, target, rendered, {
      episodeLogger: logger,
      providers: { "http.get": httpProvider },
    });

    expect((app.live?.user as { name: string } | undefined)?.name).toBe("Yui");
    // A slot left out of the snapshot starts at its declared default.
    expect(app.live?.draft).toBe("");
    // `app.init` does not run again on the client.
    expect(httpProvider).toHaveBeenCalledTimes(1);

    const eps = handle.episodes();
    expect(eps[0]?.trigger.kind).toBe("ssr.hydrate");
    expect(eps[0]?.id).toBe(rendered.bootstrapEpisode.id);
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

    const triggerKinds = handle.episodes().map((e) => e.trigger.kind);
    expect(triggerKinds[0]).toBe("ssr.hydrate");
    expect(triggerKinds.indexOf("ui.click")).toBeGreaterThan(0);
    expect(app.live?.count).toBe(1);

    handle.dispose();
    target.remove();
  });
});

describe("the served page carries what the client paints", () => {
  it("serves a markdown body as paragraphs and a closed surface as a hidden host", async () => {
    const app = await loadSource(
      withApp(`slot shown : Bool = false
tile Notes  = markdown("first line\\nsecond line\\n\\nnew paragraph")
tile Dialog = modal(text("dialog body"), open=shown, title="Details")
tile App    = column(Notes, Dialog)`),
    );
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
