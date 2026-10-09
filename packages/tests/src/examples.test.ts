import { readFileSync } from "node:fs";
import { readHttpFixture, useHttpFixture } from "@kumikijs/cli";
import { A11Y_CODES, compile, type KumikiError } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader, resolveCapabilities } from "@kumikijs/compiler/node";
import { allFiles, exampleLabel } from "@kumikijs/examples";
import { _stdlib, mount, smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const fmtErrors = (errors: KumikiError[]): string =>
  errors.map((e) => `${e.code} ${e.kind} @ ${e.pos.line}:${e.pos.col}: ${e.message}`).join("\n");

const stdlibHelpers = new Set(Object.keys(_stdlib));

function expectCompiles(file: string): void {
  const source = readFileSync(file, "utf8");
  const capabilities = resolveCapabilities(file);
  const bundled = compile(source, {
    runtimeSpecifier: "./runtime.js",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities,
  });
  if (bundled.kind === "fail") throw new Error(`failed to compile:\n${fmtErrors(bundled.errors)}`);

  const strict = compile(source, {
    runtimeSpecifier: "./runtime.js",
    capabilities,
    strictA11y: true,
  });
  const a11y = strict.kind === "fail" ? strict.errors.filter((e) => A11Y_CODES.has(e.code)) : [];
  expect(fmtErrors(a11y)).toBe("");

  if (strict.kind === "ok") {
    const helpers = [...strict.js.matchAll(/_s\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1] as string);
    expect(helpers.filter((h) => !stdlibHelpers.has(h))).toEqual([]);
  }
}

function textNodesEqual(root: HTMLElement, token: string): string[] {
  const hits: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? "").trim() === token) hits.push(node.textContent ?? "");
  }
  return hits;
}

async function expectSurvivesSmoke(file: string): Promise<void> {
  useHttpFixture(readHttpFixture(file));
  const app = await loadApp(file);
  await withRoot(async (root) => {
    const report = await smoke(app, root, { settleMs: 20 });
    const detail = report.issues
      .map((i) => `  [${i.phase}] ${i.message}${i.trigger ? ` (on ${i.trigger})` : ""}`)
      .join("\n");
    expect(report.ok, detail).toBe(true);
    expect(report.rendered).toBe(true);
  });
  await withRoot(async (root) => {
    const handle = mount(app, root);
    try {
      expect(textNodesEqual(root, "undefined")).toEqual([]);
    } finally {
      handle.dispose();
    }
  });
}

describe.each(allFiles().map((file) => ({ file, name: exampleLabel(file) })))("$name", ({
  file,
}) => {
  it("compiles, passes strict a11y, and calls only helpers the runtime has", () => {
    expectCompiles(file);
  });

  it("mounts, survives smoke, and renders no literal undefined", () => expectSurvivesSmoke(file));
});
