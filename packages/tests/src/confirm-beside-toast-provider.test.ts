import { feature } from "@kumikijs/examples";
import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { fill, mountApp, tick } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const LEAVE_GUARD = feature("38-confirm-leave-guard");
const BESIDE_TOAST = feature("186-confirm-beside-a-toast-provider");

type Hooked = AppShape & { _navigate?: (path: string, replace?: boolean) => void };

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

const dialogs = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-kumiki-confirm]"));

function answer(dialog: HTMLElement | undefined, outcome: "yes" | "no"): void {
  const btn = dialog?.querySelector<HTMLButtonElement>(
    `button[data-kumiki-confirm-action='${outcome}']`,
  );
  if (!btn) throw new Error(`no ${outcome} button on the confirm dialog`);
  btn.click();
}

function clickLink(root: HTMLElement, text: string): void {
  const link = Array.from(root.querySelectorAll("a")).find((a) => a.textContent === text);
  if (!link) throw new Error(`no link "${text}"`);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

async function mountAt(
  file: string,
  path: string,
  provider?: CapabilityProvider,
): Promise<{ app: Hooked; root: HTMLElement }> {
  const app = (await loadApp(file)) as Hooked;
  const { root, handle } = mountApp(app, {
    router: "memory",
    initialPath: path,
    ...(provider ? { providers: { "notification.show": provider } } : {}),
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
    const { app, root } = await mountAt(LEAVE_GUARD, "/edit", provider);
    fill(root, "textarea", "draft");
    clickLink(root, "Back home");
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
    const { app, root } = await mountAt(BESIDE_TOAST, "/edit", provider);
    fill(root, "textarea", "draft");
    root.querySelector("button")?.click();
    await tick(25);
    expect(app.live?.saves).toBe(1);
    expect(seen).toEqual([{ kind: "success", text: "Saved" }]);
    expect(document.querySelector("[data-kumiki-toast]"), "the provider replaced it").toBeNull();

    fill(root, "textarea", "more");
    clickLink(root, "Home");
    await tick(25);
    expect(seen, "the confirm did not reach the provider").toHaveLength(1);
    answer(dialogs()[0], "no");
    await tick(25);
    expect(app.live?.kept, "keep ran").toBe(1);
    expect(app.live?.dirty).toBe(true);
    expect(app.live?.homes).toBe(0);
    expect(root.textContent).toContain("Editor");
  });

  it("drops a held move for the next navigation, whose own question then settles it", async () => {
    const { app, root } = await mountAt(BESIDE_TOAST, "/edit");
    fill(root, "textarea", "draft");
    clickLink(root, "Home");
    await tick(25);
    const held = dialogs();
    expect(held).toHaveLength(1);

    app._navigate?.("/about");
    await tick(25);
    expect(held[0]?.isConnected, "the held move's dialog closed").toBe(false);
    expect(dialogs(), "the guard asked about /about").toHaveLength(1);
    expect(app.live?.kept, "closing it answered nothing").toBe(0);
    expect(app.live?.dirty).toBe(true);

    answer(dialogs()[0], "yes");
    await tick(25);
    expect(root.textContent).toContain("About page");
    expect(app.live?.abouts).toBe(1);
    expect(app.live?.homes).toBe(0);
  });
});
