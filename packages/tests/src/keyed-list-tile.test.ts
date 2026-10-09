import { feature } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("163-keyed-list-tile");

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
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  const { dispose } = mount(app, root);
  return {
    root,
    errors,
    done: () => {
      dispose();
      root.remove();
      spy.mockRestore();
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
        "a.1",
        "a.2",
        "b.1",
        "b.2",
        "a-1",
        "a-2",
        "b-1",
        "b-2",
        "a~1",
        "a~2",
        "b~1",
        "b~2",
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

  it("moves each node by its own key through a for-bodied tile that calls another", async () => {
    const m = await mounted();
    try {
      const before = ["a.1", "a.2", "b.1", "b.2"].map((t) => byText(m.root, t));
      click(m.root, "swap");
      expect(texts(m.root).slice(5, 9)).toEqual(["b.1", "b.2", "a.1", "a.2"]);
      for (const [i, t] of ["a.1", "a.2", "b.1", "b.2"].entries()) {
        expect(byText(m.root, t)).toBe(before[i]);
      }
      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });

  it("moves each node of a for nested directly in a for, with no key collision", async () => {
    const m = await mounted();
    try {
      const before = ["a-1", "a-2", "b-1", "b-2"].map((t) => byText(m.root, t));
      click(m.root, "flip");
      expect(m.errors).toEqual([]);
      click(m.root, "swap");
      expect(texts(m.root).slice(9, 13)).toEqual(["b-1", "b-2", "a-1", "a-2"]);
      for (const [i, t] of ["a-1", "a-2", "b-1", "b-2"].entries()) {
        expect(byText(m.root, t)).toBe(before[i]);
      }
      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });

  it("moves each node of a for reached through a branch inside a for", async () => {
    const m = await mounted();
    try {
      const before = ["a~1", "a~2", "b~1", "b~2"].map((t) => byText(m.root, t));
      click(m.root, "swap");
      expect(texts(m.root).slice(13, 17)).toEqual(["b~1", "b~2", "a~1", "a~2"]);
      for (const [i, t] of ["a~1", "a~2", "b~1", "b~2"].entries()) {
        expect(byText(m.root, t)).toBe(before[i]);
      }
      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });
});
