// A compiled program's `toast` emits: the runtime's own tests fire the effect on
// a bare app, so a banner the emit never reached would pass them.

import { feature } from "@kumikijs/examples";
import { type AppShape, TOAST_STACK_SELECTOR } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { dialogs, removeOverlays } from "./helpers/confirm.ts";
import { defined } from "./helpers/defined.ts";
import { click, mountApp, tick, waitUntil } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("285-toast-stack");

const BESIDE_CONFIRM = `slot n : Int = 0
reducer failed   on=ui.click(FailBtn) do= emit toast({kind: "error", text: "Save failed"})
reducer ask      on=ui.click(AskBtn)  do= emit confirm({title: "Discard the draft?", message: "It has not been saved.", onYes: agreed, onNo: declined})
reducer agreed   on=ui.click(_) do= n := 1
reducer declined on=ui.click(_) do= n := 2
tile FailBtn = button(text="Fail", onClick=failed)
tile AskBtn  = button(text="Ask", onClick=ask)
tile App     = column(FailBtn, AskBtn, text("n: " + n.show))
app ToastBesideConfirm
    caps   = [notification.show]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const banners = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-kumiki-toast]"));
const toastTexts = (): string[] => banners().map((b) => b.textContent ?? "");
const dismissButton = (b: Element | undefined): HTMLButtonElement =>
  defined(
    b?.querySelector<HTMLButtonElement>("button[data-kumiki-toast-dismiss]"),
    "a dismiss button",
  );
const pressEscape = (el: EventTarget): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

let dispose = (): void => {};

function mounted(app: AppShape): HTMLElement {
  const { root, handle } = mountApp(app);
  dispose = () => {
    handle.dispose();
    root.remove();
  };
  return root;
}

afterEach(() => {
  dispose();
  dispose = () => {};
  removeOverlays();
});

describe("the toasts example 285 raises", () => {
  // Two error toasts, which have no timer, so neither can leave before the assertions read them.
  it("go into one stack in <body>, oldest first, with no position of their own", async () => {
    const root = mounted(await loadApp(EXAMPLE));
    click(root, "Fail");
    await waitUntil(() => banners().length === 1);
    const first = banners()[0];
    click(root, "Fail");
    await waitUntil(() => banners().length === 2);

    const stacks = document.querySelectorAll(`body > ${TOAST_STACK_SELECTOR}`);
    expect(stacks).toHaveLength(1);
    expect(Array.from(stacks[0]?.children ?? [])).toEqual(banners());
    expect(banners()[0]).toBe(first);
    expect(banners().map((b) => b.style.position)).toEqual(["", ""]);
  });

  // Every banner as it goes in, so a stall that outlasts "Saved" cannot hide that it was shown.
  it('close the gap when "Saved" goes after its 500ms, and "Save failed" stays', async () => {
    const root = mounted(await loadApp(EXAMPLE));
    const shown: HTMLElement[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n instanceof HTMLElement && n.matches("[data-kumiki-toast]")) shown.push(n);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      click(root, "Fail");
      click(root, "Save");
      await waitUntil(() => shown.length === 2 && !shown[1]?.isConnected, { timeoutMs: 3000 });
    } finally {
      observer.disconnect();
    }

    expect(shown.map((b) => b.textContent)).toEqual(["Save failed", "Saved"]);
    expect(banners()).toEqual([shown[0]]);
    expect(shown[0]?.parentElement?.children).toHaveLength(1);
  });
});

describe("a toast beside an open confirm dialog", () => {
  /** Raise the error toast, then open the dialog, which takes focus. */
  async function openBoth(): Promise<HTMLElement> {
    const root = mounted(await loadSource(BESIDE_CONFIRM, ["notification.show"]));
    click(root, "Fail");
    await waitUntil(() => banners().length === 1);
    click(root, "Ask");
    await waitUntil(() => dialogs().length === 1);
    return root;
  }

  it("closes only the toast on Escape at its dismiss button", async () => {
    const root = await openBoth();
    const dismiss = dismissButton(banners()[0]);
    dismiss.focus();
    pressEscape(dismiss);
    // Long enough for a "No" the dialog was wrongly given to reach its reducer.
    await tick(25);

    expect(banners()).toEqual([]);
    expect(dialogs()).toHaveLength(1);
    expect(root.textContent).toContain("n: 0");
  });

  it("answers the dialog No on Escape inside it, and leaves the toast", async () => {
    const root = await openBoth();
    const focused = document.activeElement;
    expect(focused?.closest("[data-kumiki-confirm]")).toBe(dialogs()[0]);
    pressEscape(defined(focused, "the dialog's focused button"));
    await waitUntil(() => root.textContent?.includes("n: 2") ?? false);

    expect(dialogs()).toEqual([]);
    expect(toastTexts()).toEqual(["Save failed"]);
  });
});
