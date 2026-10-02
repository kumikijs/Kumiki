// Runtime-truth verification tier for the example corpus (issue #39).
//
// `examples.test.ts` proves every example compiles; `smoke.test.ts` proves it
// mounts/renders/survives interaction with a "not empty / no throw" bar. Both
// were green for the `03-union-and-match` heading bug, which compiled to
// `_s.show(undefined)` and rendered an empty-but-present heading. This tier
// closes that gap with two checks targeting the dropped-expression class:
//   1. a static scan of generated JS for the `_s.show(undefined)` sentinel, and
//   2. an assertion that no example renders a text node that is literally
//      "undefined".

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader, resolveCapabilities } from "@kumikijs/compiler/node";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { findDroppedExpressions } from "./helpers/dropped-expr.ts";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "examples");

function featureExamples(): string[] {
  const dir = join(examplesDir, "features");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".kumiki"))
    .map((f) => join(dir, f));
}

function appExamples(): string[] {
  const dir = join(examplesDir, "apps");
  return readdirSync(dir)
    .map((name) => join(dir, name, "app.kumiki"))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

function generatedJs(file: string): string {
  const src = readFileSync(file, "utf8");
  // bundle:false → the emitted JS is the app code only (not the inlined
  // runtime), so the scan targets codegen output and nothing else.
  const result = compile(src, {
    runtimeSpecifier: "./runtime.js",
    bundle: false,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities: resolveCapabilities(file),
  });
  if (result.kind !== "ok") {
    throw new Error(`${file} failed to compile: ${result.errors.map((e) => e.code).join(", ")}`);
  }
  return result.js;
}

/** Collect text nodes whose trimmed content is exactly the given token. */
function textNodesEqual(root: HTMLElement, token: string): string[] {
  const hits: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent ?? "").trim() === token) hits.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return hits;
}

const short = (file: string) => file.split(/[\\/]/).slice(-1)[0];
const appLabel = (file: string) => file.split(/[\\/]/).slice(-2).join("/");

// ── The scanner itself (unit) ────────────────────────────────────────────────
// TDD anchor: a deliberately-broken fixture must turn the guard red, and the
// benign `undefined` shapes that pervade real codegen must stay green.
describe("dropped-expression scanner", () => {
  it("flags a dropped value-argument (the 03 heading shape)", () => {
    const brokenCodegen = `const _node = ({ kind: "heading", text: _s.show(undefined), props: {} });`;
    const hits = findDroppedExpressions(brokenCodegen);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.marker).toBe("_s.show(undefined)");
  });

  it("reports every occurrence with its line number", () => {
    const js = ["a();", "({ text: _s.show(undefined) });", "b();", "_s.show(undefined);"].join(
      "\n",
    );
    const hits = findDroppedExpressions(js);
    expect(hits.map((h) => h.line)).toEqual([2, 4]);
  });

  it("does not flag the benign `undefined` tokens real codegen emits", () => {
    const benign = [
      "selector: undefined,",
      "policy: undefined,",
      "placeholder: undefined,",
      "if (x === null || x === undefined) continue;",
      "for (const y of x) if (y !== null && y !== undefined) out.push(y);",
      '({ kind: "heading", text: _s.show(_live["title"]), props: {} });',
    ].join("\n");
    expect(findDroppedExpressions(benign)).toHaveLength(0);
  });
});

// ── Static scan over the corpus (AC1 / AC4) ──────────────────────────────────
describe("feature examples — no dropped expressions in generated JS", () => {
  for (const file of featureExamples()) {
    it(`${short(file)}`, () => {
      const hits = findDroppedExpressions(generatedJs(file));
      expect(
        hits,
        `dropped expression(s) in ${short(file)} at line(s) ${hits.map((h) => h.line).join(", ")}`,
      ).toEqual([]);
    });
  }
});

describe("app examples — no dropped expressions in generated JS", () => {
  for (const file of appExamples()) {
    it(`${appLabel(file)}`, () => {
      const hits = findDroppedExpressions(generatedJs(file));
      expect(
        hits,
        `dropped expression(s) in ${appLabel(file)} at line(s) ${hits.map((h) => h.line).join(", ")}`,
      ).toEqual([]);
    });
  }
});

// ── Rendered-DOM scan (AC2) ──────────────────────────────────────────────────
// Complements the static scan: catches a raw `undefined` that reaches the DOM
// as text by a path the sentinel doesn't cover.
async function assertNoUndefinedText(file: string): Promise<void> {
  const app = await loadApp(file);
  const root = document.createElement("div");
  document.body.appendChild(root);
  let handle: { dispose: () => void } | undefined;
  try {
    handle = mount(app, root);
    const hits = textNodesEqual(root, "undefined");
    expect(hits, `${short(file)} rendered a literal "undefined" text node`).toEqual([]);
  } finally {
    handle?.dispose();
    root.remove();
  }
}

describe('feature examples — no literal "undefined" rendered', () => {
  for (const file of featureExamples()) {
    it(`${short(file)}`, () => assertNoUndefinedText(file));
  }
});

describe('app examples — no literal "undefined" rendered', () => {
  for (const file of appExamples()) {
    it(`${appLabel(file)}`, () => assertNoUndefinedText(file));
  }
});
