// SSR hydration integration test (docs/spec/runtime.md §10.6.2 + AC6 of
// issue#119). Drives the full pipeline: real .kumiki source → compile →
// `renderToString` → DOM injection → `hydrate` → user interaction → episode
// continuity. Anything that breaks the SSR → CSR seam (volatile leak, init
// re-execution, bootstrap dropped from the ring) shows up here as a failed
// expectation, not as a downstream UI bug.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEpisodeLogger, hydrate, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.js";

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

    // Reset live state so the client side starts from defaults like a real boot.
    // We intentionally hydrate onto an empty target — the SSR HTML is asserted
    // above as a string. Injecting it here would double-render (the runtime
    // currently appends rather than replaces existing children on first mount).
    app.live = undefined;
    const target = document.createElement("div");
    document.body.appendChild(target);

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
    // app.start has no user-declared lifecycle reducer in this fixture, so the
    // next observable episode comes from user input (or stays absent).
    expect(eps[0]?.steps.map((s) => s.kind)).toEqual([
      "effect-start",
      "effect-end",
      "reducer",
      "signal-update",
    ]);

    // Click the IncBtn — the runtime renders a real <button> after hydration,
    // so a synthetic click goes through the compiled handler. We invoke the
    // native `.click()` method so happy-dom routes the event through the
    // standard listener path instead of a manual bubbling dispatch.
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
