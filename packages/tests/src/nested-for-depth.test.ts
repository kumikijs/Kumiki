import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { byText, click, mountFeature, texts, withRoot } from "./helpers/dom.ts";
import { loadSource, TMP_ROOT } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";
import { WINDOWS_LIKE_STACK_KB } from "./helpers/stack.ts";

const DEPTH = 28;
const XS = "slot xs : List(Int) = [1]";

// The most `for`s `App` may nest: one more is past the parser's 256 levels.
const DEEPEST = 250;

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

// Each check starts a `node` process.
const CHILD = { timeout: 60_000 } as const;

// The DOM `kumiki smoke` mounts an app into, found through the CLI, which depends on it.
const GLOBAL_DOM = pathToFileURL(
  createRequire(createRequire(import.meta.url).resolve("@kumikijs/cli")).resolve(
    "@happy-dom/global-registrator",
  ),
).href;

/**
 * What a child on a stack of `stackKb` KB reports once it imports the built module for `src`, which
 * mounts its app into `#root`: the text of `#root`, or whatever the child wrote to stderr.
 */
function renderedInChild(stackKb: number, src: string): { status: number | null; out: string } {
  const result = compile(src, {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
  });
  if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.message).join("\n"));
  const file = join(mkdtempSync(join(TMP_ROOT, "nest-child-")), "app.mjs");
  writeFileSync(file, result.js);
  const child = `const { GlobalRegistrator } = await import(${JSON.stringify(GLOBAL_DOM)});
GlobalRegistrator.register({ url: "http://localhost/" });
const root = document.createElement("div");
root.id = "root";
document.body.append(root);
await import(${JSON.stringify(pathToFileURL(file).href)});
process.stdout.write(root.textContent);`;
  const run = spawnSync(
    process.execPath,
    [`--stack-size=${stackKb}`, "--input-type=module", "-e", child],
    { encoding: "utf8" },
  );
  return { status: run.status, out: run.stderr === "" ? run.stdout : run.stderr };
}

describe("a nest of fors", () => {
  it.each([
    [`${DEPTH} deep in one tile`, nestedFors(DEPTH)],
    [`${DEPTH} deep across a chain of for-bodied tiles`, forChain(DEPTH)],
    [`${DEEPEST} deep in one tile, as deep as the parser allows`, nestedFors(DEEPEST)],
  ])("passes smoke %s", async (_, src) => {
    const app = await loadSource(src);
    const report = await withRoot((root) => smoke(app, root, { settleMs: 20 }));
    expect(report.issues.map((i) => i.message)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  // Loading the module compiles it in full, which takes more stack than `node --check` does.
  it(`renders ${DEEPEST} deep in one tile on a stack as small as Windows'`, CHILD, () => {
    const rendered = renderedInChild(WINDOWS_LIKE_STACK_KB, nestedFors(DEEPEST));
    expect(rendered).toEqual({ status: 0, out: "leaf" });
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
