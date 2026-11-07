// The effects write their markers themselves, so each entry is checked against
// the element its effect actually appends: a marker renamed in an effect would
// otherwise drop that overlay from every scenario without a word.

import type { AppShape, BuiltinInstaller, CapabilityRegistry } from "@kumikijs/runtime";
import { installConfirm, installToast, RUNTIME_OVERLAY_SELECTORS } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const caps: CapabilityRegistry = { has: () => false, provider: () => undefined };

/** Fire the effect `install` adds, and return every element it added to the document. */
function added(install: BuiltinInstaller, name: string, input: unknown): Element[] {
  const app: AppShape = { slots: {}, caps: [], reducers: [], effects: {}, init: [] };
  install(app, { navigate: () => {}, back: () => {} });
  const all = (): Element[] => Array.from(document.body.querySelectorAll("*"));
  const before = new Set(all());
  // Not awaited: a confirm's invoke settles when the dialog is answered. Both
  // effects append synchronously, before their first `await`.
  void defined(app.effects[name], `the installed ${name} effect`).invoke(input, caps);
  return all().filter((el) => !before.has(el));
}

const PRODUCERS = [
  {
    selector: "[data-kumiki-toast]",
    open: () => added(installToast, "toast", { kind: "info", text: "Saved" }),
    shows: "Saved",
  },
  {
    selector: "[data-kumiki-confirm]",
    open: () => added(installConfirm, "confirm", { title: "Reset?", message: "Sure?" }),
    shows: "Reset?Sure?NoYes",
  },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RUNTIME_OVERLAY_SELECTORS", () => {
  it("lists one selector per effect that renders outside the mount root", () => {
    expect(PRODUCERS.map((p) => p.selector)).toEqual([...RUNTIME_OVERLAY_SELECTORS]);
  });

  for (const p of PRODUCERS) {
    // One element, and the one that holds everything its effect shows: what a
    // step reads is its whole text, a confirm's title and message as well as
    // its buttons. A toast's banner goes into the stack rather than straight
    // into <body>, and the stack, which holds every toast, is not it.
    it(`${p.selector} matches the element that holds what its effect shows`, () => {
      const marked = p.open().filter((el) => el.matches(p.selector));
      expect(marked).toHaveLength(1);
      expect(marked[0]?.textContent).toBe(p.shows);
    });
  }
});
