// stdlib.md §2.5 / §2.6.5, routing.md §3.5.2: a host provider for
// `notification.show` replaces the toast banner and nothing else. `confirm`
// renders the runtime's own dialog whether or not one is registered, so a
// `route.leave` guard that asks still gets an answer, its `onYes` / `onNo`
// reducer runs, and the answer settles the move the guard holds. A move that
// is held gives way to the next navigation instead of swallowing it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppShape, CapabilityProvider } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const features = join(here, "..", "examples", "features");
const LEAVE_GUARD = join(features, "38-confirm-leave-guard.kumiki");
const BESIDE_TOAST = join(features, "186-confirm-beside-a-toast-provider.kumiki");

type Hooked = AppShape & { _navigate?: (path: string, replace?: boolean) => void };

const tick = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A host provider replacing the toast UI: it records what it is handed and answers ok. */
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

function type(root: HTMLElement, value: string): void {
  const area = root.querySelector("textarea");
  if (!area) throw new Error("no textarea");
  area.value = value;
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickLink(root: HTMLElement, text: string): void {
  const link = Array.from(root.querySelectorAll("a")).find((a) => a.textContent === text);
  if (!link) throw new Error(`no link "${text}"`);
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

let root: HTMLElement;
let dispose: (() => void) | undefined;

async function mountAt(file: string, path: string, provider?: CapabilityProvider) {
  const app = (await loadApp(file)) as Hooked;
  root = document.createElement("div");
  document.body.appendChild(root);
  const opts = { router: "memory" as const, initialPath: path };
  dispose = mount(
    app,
    root,
    provider ? { ...opts, providers: { "notification.show": provider } } : opts,
  ).dispose;
  return app;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  for (const el of dialogs()) el.remove();
  for (const el of Array.from(document.querySelectorAll("[data-kumiki-toast]"))) el.remove();
});

describe("a notification.show provider beside a leave guard", () => {
  it("leaves the guard's confirm to the built-in dialog, whose Yes lands Home", async () => {
    const { seen, provider } = recordingProvider();
    const app = await mountAt(LEAVE_GUARD, "/edit", provider);
    type(root, "draft");
    clickLink(root, "Back home");
    await tick();

    expect(seen, "the provider is handed no confirm").toEqual([]);
    expect(dialogs()).toHaveLength(1);
    expect(root.textContent).toContain("Editor");

    answer(dialogs()[0], "yes");
    await tick();
    expect(dialogs()).toHaveLength(0);
    expect(app.live?.dirty, "continueLeave ran").toBe(false);
    expect(app.live?.visits, "route.enter(/) ran").toBe(1);
    expect(root.textContent).toContain("Home");
  });

  it("hands the provider the toast and only the toast; No keeps the page", async () => {
    const { seen, provider } = recordingProvider();
    const app = await mountAt(BESIDE_TOAST, "/edit", provider);
    type(root, "draft");
    root.querySelector("button")?.click();
    await tick();
    expect(app.live?.saves).toBe(1);
    expect(seen).toEqual([{ kind: "success", text: "Saved" }]);
    expect(document.querySelector("[data-kumiki-toast]"), "the provider replaced it").toBeNull();

    type(root, "more");
    clickLink(root, "Home");
    await tick();
    expect(seen, "the confirm did not reach the provider").toHaveLength(1);
    answer(dialogs()[0], "no");
    await tick();
    expect(app.live?.kept, "keep ran").toBe(1);
    expect(app.live?.dirty).toBe(true);
    expect(app.live?.homes).toBe(0);
    expect(root.textContent).toContain("Editor");
  });

  it("drops a held move for the next navigation, whose own question then settles it", async () => {
    const app = await mountAt(BESIDE_TOAST, "/edit");
    type(root, "draft");
    clickLink(root, "Home");
    await tick();
    const held = dialogs();
    expect(held).toHaveLength(1);

    app._navigate?.("/about");
    await tick();
    expect(held[0]?.isConnected, "the held move's dialog closed").toBe(false);
    expect(dialogs(), "the guard asked about /about").toHaveLength(1);
    expect(app.live?.kept, "closing it answered nothing").toBe(0);
    expect(app.live?.dirty).toBe(true);

    answer(dialogs()[0], "yes");
    await tick();
    expect(root.textContent).toContain("About page");
    expect(app.live?.abouts).toBe(1);
    expect(app.live?.homes).toBe(0);
  });
});
