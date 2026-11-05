import { feature } from "@kumikijs/examples";
import { mount, smoke } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { click, freshRoot, withRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const DEPTH = 28;

const program = (tiles: string): string => `
slot xs : List(Int) = [1]
${tiles}
app M caps=[] routes={"/" -> Page, "/404" -> Page} init=[]`;

const nestedFors = (depth: number): string =>
  program(
    `tile Page = column(${Array.from({ length: depth }, (_, d) => `for x${d + 1} in xs `).join("")}text("leaf"))`,
  );

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

describe(`a nest of ${DEPTH} fors`, () => {
  it.each([
    ["in one tile", nestedFors(DEPTH)],
    ["across a chain of for-bodied tiles", forChain(DEPTH)],
  ])("passes smoke %s", async (_, src) => {
    const app = await loadSource(src);
    const report = await withRoot((root) => smoke(app, root, { settleMs: 20 }));
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

/** Mount the example, collecting every `console.error` until the test ends. */
async function mounted(): Promise<{ root: HTMLElement; errors: string[] }> {
  const app = await loadApp(feature("257-deep-nested-for"));
  const root = freshRoot();
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const { dispose } = mount(app, root);
  onTestFinished(() => {
    dispose();
    root.remove();
    spy.mockRestore();
  });
  return { root, errors };
}

describe(`a reorder in a nest ${DEPTH} deep`, () => {
  it.each([
    ["in one tile", "/"],
    ["across a chain of tiles", "."],
  ])("%s moves each node's element at the outermost and the innermost level", async (_, sep) => {
    const { root, errors } = await mounted();
    const names = ["a1", "a2", "b1", "b2"].map(([o, i]) => `${o}${sep}${i}`);
    const [a1, a2, b1, b2] = names as [string, string, string, string];
    expect(leaves(root, sep)).toEqual([a1, a2, b1, b2]);
    const before = new Map(names.map((n) => [n, byText(root, n)]));

    click(root, "flip outer");
    expect(leaves(root, sep)).toEqual([b1, b2, a1, a2]);
    for (const n of names) expect(byText(root, n)).toBe(before.get(n));

    click(root, "flip inner");
    expect(leaves(root, sep)).toEqual([b2, b1, a2, a1]);
    for (const n of names) expect(byText(root, n)).toBe(before.get(n));

    expect(errors).toEqual([]);
  });
});
