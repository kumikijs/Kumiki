import { smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { byText, click, mountFeature, texts, withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const DEPTH = 28;
const XS = "slot xs : List(Int) = [1]";

const nestedFors = (depth: number): string =>
  withApp(
    `${XS}
tile App = column(${Array.from({ length: depth }, (_, d) => `for x${d + 1} in xs `).join("")}text("leaf"))`,
  );

const forChain = (depth: number): string =>
  withApp(
    [
      XS,
      "tile App = column(L1)",
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

describe(`a reorder in a nest ${DEPTH} deep`, () => {
  it.each([
    ["in one tile", "/"],
    ["across a chain of tiles", "."],
  ])("%s moves each node's element at the outermost and the innermost level", async (_, sep) => {
    const { root, errors } = await mountFeature("257-deep-nested-for");
    const names = ["a1", "a2", "b1", "b2"].map(([o, i]) => `${o}${sep}${i}`);
    const [a1, a2, b1, b2] = names as [string, string, string, string];
    expect(texts(root).filter((s) => s.includes(sep))).toEqual([a1, a2, b1, b2]);
    const before = new Map(names.map((n) => [n, byText(root, n)]));

    click(root, "flip outer");
    expect(texts(root).filter((s) => s.includes(sep))).toEqual([b1, b2, a1, a2]);
    for (const n of names) expect(byText(root, n)).toBe(before.get(n));

    click(root, "flip inner");
    expect(texts(root).filter((s) => s.includes(sep))).toEqual([b2, b1, a2, a1]);
    for (const n of names) expect(byText(root, n)).toBe(before.get(n));

    expect(errors).toEqual([]);
  });
});
