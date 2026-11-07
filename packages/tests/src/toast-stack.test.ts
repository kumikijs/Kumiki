// A compiled program's `toast` emits: the runtime's own tests fire the effect on
// a bare app, so a banner the emit never reached would pass them.

import { feature } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { click, mountApp, waitUntil } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("285-toast-stack");

const banners = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-kumiki-toast]"));
const texts = (): string[] => banners().map((b) => b.textContent ?? "");
const errorToast = (): HTMLElement =>
  defined(
    document.querySelector<HTMLElement>("[data-kumiki-toast][data-level='error']"),
    "the error toast",
  );
const dismissButton = (b: Element): HTMLButtonElement =>
  defined(
    b.querySelector<HTMLButtonElement>("button[data-kumiki-toast-dismiss]"),
    "a dismiss button",
  );
const pressEscape = (el: EventTarget): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

let root: HTMLElement;
let dispose: () => void;

/** Mount example 285, click Fail then Save, and wait for both toasts. */
beforeEach(async () => {
  const mounted = mountApp(await loadApp(EXAMPLE));
  root = mounted.root;
  dispose = () => {
    mounted.handle.dispose();
    root.remove();
  };
  click(root, "Fail");
  click(root, "Save");
  await waitUntil(() => banners().length === 2);
});

afterEach(() => {
  dispose();
  // The stack, and any banner outside it, so the next test starts with no toast.
  for (const el of document.querySelectorAll("[data-kumiki-toast-stack], [data-kumiki-toast]")) {
    el.remove();
  }
});

describe("the error toast, whose default duration is 0", () => {
  it("can be dismissed from a button with an accessible name", () => {
    const button = dismissButton(errorToast());
    expect(button.getAttribute("aria-label")).toBe("Dismiss");
    button.click();
    expect(texts()).toEqual(["Saved"]);
  });

  it("is dismissed by Escape on its focused dismiss button", () => {
    const button = dismissButton(errorToast());
    button.focus();
    pressEscape(button);
    expect(texts()).toEqual(["Saved"]);
  });

  it.each<[string, () => EventTarget]>([
    ["the document", () => document],
    ["the app's own button", () => defined(root.querySelector("button"), "the app's button")],
  ])("stays when Escape is pressed on %s", (_, target) => {
    pressEscape(target());
    expect(texts()).toEqual(["Save failed", "Saved"]);
  });
});

describe("toasts shown together", () => {
  it("share one stack fixed to the bottom-right, the newest nearest the corner", () => {
    const stack = defined(errorToast().parentElement, "the stack");
    expect(stack.matches("body > [data-kumiki-toast-stack]")).toBe(true);
    expect(banners().map((b) => b.parentElement)).toEqual([stack, stack]);
    expect(texts()).toEqual(["Save failed", "Saved"]);
    const { position, bottom, right, flexDirection } = stack.style;
    expect({ position, bottom, right, flexDirection }).toEqual({
      position: "fixed",
      bottom: "24px",
      right: "24px",
      flexDirection: "column",
    });
    expect(banners().map((b) => b.style.position)).toEqual(["", ""]);
  });

  it("keep the role, live region and level each banner had", () => {
    expect(
      banners().map((b) => [b.dataset.level, b.getAttribute("role"), b.getAttribute("aria-live")]),
    ).toEqual([
      ["error", "status", "polite"],
      ["success", "status", "polite"],
    ]);
  });

  it("close the gap when the success toast goes on its own, and the error toast stays", async () => {
    await waitUntil(() => banners().length === 1, { timeoutMs: 3000 });
    expect(texts()).toEqual(["Save failed"]);
    expect(errorToast().parentElement?.children).toHaveLength(1);
  });
});
