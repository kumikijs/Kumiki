// The effects write their markers themselves, so each entry is checked against
// the element its effect actually appends: a marker renamed in an effect would
// otherwise drop that overlay from every scenario without a word.

import type { AppShape, BuiltinInstaller, CapabilityRegistry } from "@kumikijs/runtime";
import { installConfirm, installToast, RUNTIME_OVERLAY_SELECTORS } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const caps: CapabilityRegistry = { has: () => false, provider: () => undefined };

/** Fire the effect `install` adds, and return what it appended to `<body>`. */
function appended(install: BuiltinInstaller, name: string, input: unknown): Element[] {
  const app: AppShape = { slots: {}, caps: [], reducers: [], effects: {}, init: [] };
  install(app, { navigate: () => {}, back: () => {} });
  const before = new Set(Array.from(document.body.children));
  // Not awaited: a confirm's invoke settles when the dialog is answered. Both
  // effects append synchronously, before their first `await`.
  void defined(app.effects[name], `the installed ${name} effect`).invoke(input, caps);
  return Array.from(document.body.children).filter((el) => !before.has(el));
}

const PRODUCERS = [
  {
    selector: "[data-kumiki-toast]",
    open: () => appended(installToast, "toast", { kind: "info", text: "Saved" }),
  },
  {
    selector: "[data-kumiki-confirm]",
    open: () => appended(installConfirm, "confirm", { title: "Reset?", message: "Sure?" }),
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
    // The element appended, not something inside it: what a step reads is its
    // whole text, a confirm's title and message as well as its buttons.
    it(`${p.selector} matches what its effect appends to <body>`, () => {
      const els = p.open();
      expect(els).toHaveLength(1);
      expect(els[0]?.matches(p.selector)).toBe(true);
    });
  }
});
