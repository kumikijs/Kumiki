import { feature } from "@kumikijs/examples";
import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { answer, dialogs } from "./helpers/confirm.ts";
import { fill, followLink, mountApp, navigate, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const LEAVE_GUARD = feature("38-confirm-leave-guard");
const BESIDE_TOAST = feature("186-confirm-beside-a-toast-provider");

function recordingProvider(): { seen: unknown[]; provider: CapabilityProvider } {
  const seen: unknown[] = [];
  return {
    seen,
    provider: (input) => {
      seen.push(input);
      return { kind: "ok", value: null };
    },
  };
}

async function mountAt(
  file: string,
  path: string,
  opts: { provider?: CapabilityProvider; router?: "history" | "memory" } = {},
): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadApp(file);
  const router = opts.router ?? "memory";
  if (router === "history") history.replaceState(null, "", path);
  const { root, handle } = mountApp(app, {
    router,
    ...(router === "memory" ? { initialPath: path } : {}),
    ...(opts.provider ? { providers: { "notification.show": opts.provider } } : {}),
  });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
    for (const el of dialogs()) el.remove();
    for (const el of Array.from(document.querySelectorAll("[data-kumiki-toast]"))) el.remove();
  });
  return { app, root };
}

describe("a notification.show provider beside a leave guard", () => {
  it("leaves the guard's confirm to the built-in dialog, whose Yes lands Home", async () => {
    const { seen, provider } = recordingProvider();
    const { app, root } = await mountAt(LEAVE_GUARD, "/edit", { provider });
    fill(root, "textarea", "draft");
    followLink(root, "Back home");
    await tick(25);

    expect(seen, "the provider is handed no confirm").toEqual([]);
    expect(dialogs()).toHaveLength(1);
    expect(root.textContent).toContain("Editor");

    answer(dialogs()[0], "yes");
    await tick(25);
    expect(dialogs()).toHaveLength(0);
    expect(app.live?.dirty, "continueLeave ran").toBe(false);
    expect(app.live?.visits, "route.enter(/) ran").toBe(1);
    expect(root.textContent).toContain("Home");
  });

  it("hands the provider the toast and only the toast; No keeps the page", async () => {
    const { seen, provider } = recordingProvider();
    const { app, root } = await mountAt(BESIDE_TOAST, "/edit", { provider });
    fill(root, "textarea", "draft");
    root.querySelector("button")?.click();
    await tick(25);
    expect(app.live?.saves).toBe(1);
    expect(seen).toEqual([{ kind: "success", text: "Saved" }]);
    expect(document.querySelector("[data-kumiki-toast]"), "the provider replaced it").toBeNull();

    fill(root, "textarea", "more");
    followLink(root, "Home");
    await tick(25);
    expect(seen, "the confirm did not reach the provider").toHaveLength(1);
    answer(dialogs()[0], "no");
    await tick(25);
    expect(app.live?.kept, "keep ran").toBe(1);
    expect(app.live?.dirty).toBe(true);
    expect(app.live?.homes).toBe(0);
    expect(root.textContent).toContain("Editor");
  });

  it("withdraws a held move on browser Back: the page is not entered again, the edits stay", async () => {
    const { app, root } = await mountAt(BESIDE_TOAST, "/edit", { router: "history" });
    const opens = app.live?.opens;
    fill(root, "textarea", "draft");
    followLink(root, "Home");
    await tick(25);
    const held = dialogs();
    expect(held).toHaveLength(1);
    expect(location.pathname).toBe("/");

    history.back();
    await tick(25);
    expect(location.pathname).toBe("/edit");
    expect(held[0]?.isConnected, "the held move's dialog closed").toBe(false);
    expect(dialogs(), "nothing was left, so the guard did not ask").toHaveLength(0);
    expect(app.live?.kept, "closing it answered nothing").toBe(0);
    expect(app.live?.dirty).toBe(true);
    expect(app.live?.homes).toBe(0);
    expect(app.live?.opens, "route.enter(/edit) did not run again").toBe(opens);
    expect(root.textContent).toContain("Editor");

    await navigate(app, "/about");
    expect(dialogs(), "the edits are still guarded").toHaveLength(1);
  });
});
