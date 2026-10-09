import { feature } from "@kumikijs/examples";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { click, freshRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

/** The element whose own text is `text`. */
function byText(root: HTMLElement, text: string): Element {
  const el = [...root.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && e.textContent === text,
  );
  if (!el) throw new Error(`no element reads "${text}"`);
  return el;
}

/** The leaf texts, in document order. */
function texts(root: HTMLElement): string[] {
  return [...root.querySelectorAll("*")]
    .filter((e) => e.children.length === 0)
    .map((e) => e.textContent ?? "");
}

/** Mount the example, collecting every `console.error` until the test ends. */
async function mounted(): Promise<{ root: HTMLElement; errors: unknown[] }> {
  const app = await loadApp(feature("163-keyed-list-tile"));
  const root = freshRoot();
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  const { dispose } = mount(app, root);
  onTestFinished(() => {
    dispose();
    root.remove();
    spy.mockRestore();
  });
  return { root, errors };
}

describe("a keyed call to a for-bodied tile", () => {
  it("renders each node of the list, with an explicit key and an implicit one", async () => {
    const { root, errors } = await mounted();
    expect(texts(root)).toEqual([
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
    expect(errors).toEqual([]);
  });

  it.each<[string, string[], string[], number, string[]]>([
    [
      "each group's elements when the outer list is reordered",
      ["flip"],
      ["x/x1", "x/x2", "y/y1"],
      2,
      ["y/y1", "x/x1", "x/x2"],
    ],
    [
      "each tag's element when the list under the explicit key is reordered",
      ["swap"],
      ["tag:a", "tag:b"],
      0,
      ["tag:b", "tag:a"],
    ],
    [
      "each node by its own key through a for-bodied tile that calls another",
      ["swap"],
      ["a.1", "a.2", "b.1", "b.2"],
      5,
      ["b.1", "b.2", "a.1", "a.2"],
    ],
    [
      "each node of a for nested directly in a for, with no key collision",
      ["flip", "swap"],
      ["a-1", "a-2", "b-1", "b-2"],
      9,
      ["b-1", "b-2", "a-1", "a-2"],
    ],
    [
      "each node of a for reached through a branch inside a for",
      ["swap"],
      ["a~1", "a~2", "b~1", "b~2"],
      13,
      ["b~1", "b~2", "a~1", "a~2"],
    ],
  ])("moves %s", async (_what, presses, nodes, at, reordered) => {
    const { root, errors } = await mounted();
    const before = nodes.map((t) => byText(root, t));
    for (const label of presses) click(root, label);
    expect(texts(root).slice(at, at + nodes.length)).toEqual(reordered);
    for (const [i, t] of nodes.entries()) {
      expect(byText(root, t)).toBe(before[i]);
    }
    expect(errors).toEqual([]);
  });
});
