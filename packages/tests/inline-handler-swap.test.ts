// A conditional that swaps two inline tiles differing only in their handler
// must reach the new reducer — without giving up the identity-preserving reuse
// path that keeps focus, caret and `<select>` state alive.
//
// The reconciler compared tile fields to choose between "patch in place" and
// "reuse untouched", and treated any two functions as equal because codegen
// minted a fresh closure per render. The element was therefore reused with the
// closure it was created with, and the else-branch reducer never fired. Nothing
// threw; no diagnostic fired. Codegen now memoises one closure per reducer
// list, so an unchanged handler is equal *by reference* and a changed one is
// visibly different.
//
// Both properties are asserted here, because fixing the first by always
// rebuilding would be a silent regression of the second.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(
  here,
  "..",
  "examples",
  "features",
  "62-conditional-inline-tile-handlers.kumiki",
);

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!found) throw new Error(`button "${text}" not found`);
  return found;
}

describe("conditional inline tiles that differ only in their handler", () => {
  it("dispatches to the branch that is live, not the one it was created with", async () => {
    const app = await loadApp(example);
    const root = freshRoot();
    mount(app, root);

    button(root, "act").click();
    expect(app.live?.log).toBe("A");

    button(root, "flip").click();
    expect(app.live?.mode).toBe(false);

    // The element is reused across the flip; before the fix it kept `alpha`.
    button(root, "act").click();
    expect(app.live?.log).toBe("AB");

    // Not a one-shot: flipping back restores the first branch's reducer.
    button(root, "flip").click();
    button(root, "act").click();
    expect(app.live?.log).toBe("ABA");
  });

  it("still reuses the element rather than rebuilding it", async () => {
    const app = await loadApp(example);
    const root = freshRoot();
    mount(app, root);

    const before = button(root, "act");
    button(root, "flip").click();
    const afterFlip = button(root, "act");
    // Same DOM node: the swap goes through the patch path, not a rebuild. A
    // rebuild here would discard focus and caret on every conditional swap.
    expect(afterFlip).toBe(before);

    // And a render that changes nothing about the button leaves it alone too.
    button(root, "act").click();
    expect(button(root, "act")).toBe(before);
  });
});
