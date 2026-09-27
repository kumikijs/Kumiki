// A key on a call to a user tile whose body is a `for` — written at the call
// site, or stamped by a surrounding `for` — keys each node the list renders.
// The key used to be spread into the list itself, an object of its indices
// with no `kind`, which no renderer draws; and a `for` whose iterations each
// render such a list left a list inside the child list, which drew the same
// nothing. The example is mounted, and a reorder is driven on both forms: the
// keyed reconciler has to move each node's element, not rebuild it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "163-keyed-list-tile.kumiki");

/** The element whose own text is `text`. */
function byText(root: HTMLElement, text: string): Element {
  const el = [...root.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && e.textContent === text,
  );
  if (!el) throw new Error(`no element reads "${text}"`);
  return el;
}

function click(root: HTMLElement, text: string): void {
  (byText(root, text) as HTMLElement).click();
}

/** The leaf texts, in document order. */
function texts(root: HTMLElement): string[] {
  return [...root.querySelectorAll("*")]
    .filter((e) => e.children.length === 0)
    .map((e) => e.textContent ?? "");
}

async function mounted() {
  const app = await loadApp(EXAMPLE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  const { dispose } = mount(app, root);
  return {
    root,
    errors,
    done: () => {
      dispose();
      root.remove();
      console.error = original;
    },
  };
}

describe("a keyed call to a for-bodied tile", () => {
  it("renders each node of the list, with an explicit key and an implicit one", async () => {
    const m = await mounted();
    try {
      expect(texts(m.root)).toEqual([
        "tag:a",
        "tag:b",
        "x/x1",
        "x/x2",
        "y/y1",
        "flip",
        "swap",
        "end",
      ]);
      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });

  it("moves each group's elements when the outer list is reordered", async () => {
    const m = await mounted();
    try {
      const before = ["x/x1", "x/x2", "y/y1"].map((t) => byText(m.root, t));
      click(m.root, "flip");
      expect(texts(m.root).slice(2, 5)).toEqual(["y/y1", "x/x1", "x/x2"]);
      for (const [i, t] of ["x/x1", "x/x2", "y/y1"].entries()) {
        expect(byText(m.root, t)).toBe(before[i]);
      }
      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });

  it("moves each tag's element when the list under the explicit key is reordered", async () => {
    const m = await mounted();
    try {
      const before = ["tag:a", "tag:b"].map((t) => byText(m.root, t));
      click(m.root, "swap");
      expect(texts(m.root).slice(0, 2)).toEqual(["tag:b", "tag:a"]);
      for (const [i, t] of ["tag:a", "tag:b"].entries()) {
        expect(byText(m.root, t)).toBe(before[i]);
      }
      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });
});
