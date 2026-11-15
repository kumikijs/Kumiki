import type { TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appOf } from "./helpers/app.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  root.remove();
});

/** A fieldset of three inputs with neither a bind nor an id, as a `ui.input`-driven form compiles. */
function form(legend: () => string): () => TileNode {
  return () => ({
    kind: "fieldset",
    props: { legend: legend() },
    children: [
      { kind: "input", value: "a" },
      { kind: "input", value: "b" },
      { kind: "input", value: "c" },
    ],
  });
}

describe("a pass leaves focus on the control that had it", () => {
  it.each([
    ["adds", "", "Hi"],
    ["removes", "Hi", ""],
  ])("when a fieldset %s its legend in front of an input with no bind or id", (_, before, after) => {
    let legend = before;
    const app = appOf(form(() => legend));
    const { dispose } = mount(app, root);
    const middle = defined(root.querySelectorAll("input")[1], "the middle input");
    middle.focus();

    legend = after;
    app._rerender?.();

    expect(root.querySelectorAll("input")[1]).toBe(middle);
    expect(document.activeElement).toBe(middle);
    dispose();
  });
});
