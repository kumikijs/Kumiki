// A node of nested `for`s is keyed by the keys of every loop over it, one
// element per loop (runtime.md §10.3.10), so its key grows with the depth of
// the nest rather than doubling at each level. The two shapes of a nest are
// mounted and driven by the smoke tier at 28 levels: 28 `for`s in one tile,
// and 28 for-bodied tiles each calling the next. The example nests both 28
// deep over a two-element list at the outermost and the innermost level, and
// reversing either list has to move each node's element, not rebuild it.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, smoke } from "@kumikijs/runtime";
import { describe, expect, it, vi } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "257-deep-nested-for.kumiki");

const DEPTH = 28;

const program = (tiles: string): string => `
slot xs : List(Int) = [1]
${tiles}
app M caps=[] routes={"/" -> Page, "/404" -> Page} init=[]`;

/** `depth` `for`s nested in one tile, the innermost rendering one `text`. */
const nestedFors = (depth: number): string =>
  program(
    `tile Page = column(${Array.from({ length: depth }, (_, d) => `for x${d + 1} in xs `).join("")}text("leaf"))`,
  );

/** `depth` tiles, each a `for` whose body calls the next; the last renders one `text`. */
const forChain = (depth: number): string =>
  program(
    [
      "tile Page = column(L1)",
      ...Array.from(
        { length: depth },
        (_, d) => `tile L${d + 1} = for x in xs ${d + 1 === depth ? 'text("leaf")' : `L${d + 2}`}`,
      ),
    ].join("\n"),
  );

async function smoked(src: string): ReturnType<typeof smoke> {
  const app = await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    return await smoke(app, root, { settleMs: 20 });
  } finally {
    root.remove();
  }
}

describe(`a nest of ${DEPTH} fors`, () => {
  it("passes smoke in one tile", async () => {
    const report = await smoked(nestedFors(DEPTH));
    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("passes smoke across a chain of for-bodied tiles", async () => {
    const report = await smoked(forChain(DEPTH));
    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

/** The element whose own text is `text`. */
function byText(root: HTMLElement, text: string): Element {
  const el = [...root.querySelectorAll("*")].find(
    (e) => e.children.length === 0 && e.textContent === text,
  );
  if (!el) throw new Error(`no element reads "${text}"`);
  return el;
}

/** The leaf texts that `sep` joins, in document order. */
function leaves(root: HTMLElement, sep: string): string[] {
  return [...root.querySelectorAll("*")]
    .filter((e) => e.children.length === 0 && e.textContent?.includes(sep))
    .map((e) => e.textContent ?? "");
}

describe(`a reorder in a nest ${DEPTH} deep`, () => {
  async function mounted() {
    const app = await loadApp(EXAMPLE);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
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

  const click = (root: HTMLElement, id: string): void =>
    (root.querySelector(`#${id}`) as HTMLElement).click();

  it.each([
    ["in one tile", "/"],
    ["across a chain of tiles", "."],
  ])("%s moves each node's element at the outermost and the innermost level", async (_, sep) => {
    const m = await mounted();
    try {
      const names = ["a1", "a2", "b1", "b2"].map(([o, i]) => `${o}${sep}${i}`);
      const [a1, a2, b1, b2] = names as [string, string, string, string];
      expect(leaves(m.root, sep)).toEqual([a1, a2, b1, b2]);
      const before = new Map(names.map((n) => [n, byText(m.root, n)]));

      click(m.root, "flip-outer");
      expect(leaves(m.root, sep)).toEqual([b1, b2, a1, a2]);
      for (const n of names) expect(byText(m.root, n)).toBe(before.get(n));

      click(m.root, "flip-inner");
      expect(leaves(m.root, sep)).toEqual([b2, b1, a2, a1]);
      for (const n of names) expect(byText(m.root, n)).toBe(before.get(n));

      expect(m.errors).toEqual([]);
    } finally {
      m.done();
    }
  });
});
