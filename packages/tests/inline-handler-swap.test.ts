import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { type AppShape, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, ".smoke-tmp"), { recursive: true });
const example = join(
  here,
  "..",
  "examples",
  "features",
  "62-conditional-inline-tile-handlers.kumiki",
);

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

const counter = join(here, "..", "examples", "features", "01-slot-and-reducer.kumiki");

/**
 * Compile with `exportApp` and hand back the factory, which `loadApp` does not expose — the point of these tests is that two instances stay independent, so the default instance alone is not enough.
 */
async function loadFactory(kumikiPath: string): Promise<() => AppShape> {
  const result = compile(readFileSync(kumikiPath, "utf8"), {
    runtimeSpecifier: "ignored",
    bundle: true,
    exportApp: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
  });
  if (result.kind !== "ok") {
    throw new Error(result.errors.map((e) => `${e.code} ${e.message}`).join(", "));
  }
  const dir = mkdtempSync(join(here, ".smoke-tmp", "factory-"));
  const file = join(dir, "app.mjs");
  writeFileSync(
    file,
    result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, ""),
  );
  const mod: { createApp: () => AppShape } = await import(
    `${pathToFileURL(file).href}?t=${Date.now()}`
  );
  return mod.createApp;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!found) throw new Error(`button "${text}" not found`);
  return found;
}

describe("conditional inline tiles that differ only in their handler", () => {
  it("dispatches to the branch that is live, not the one it was created with", async () => {
    const app = await loadApp(example);
    const root = freshRoot();
    mount(app, root);

    button(root, "act").click();
    expect(app.live?.log).toBe("A");

    button(root, "flip").click();
    expect(app.live?.mode).toBe(false);

    // The element is reused across the flip; before the fix it kept `alpha`.
    button(root, "act").click();
    expect(app.live?.log).toBe("AB");

    // Not a one-shot: flipping back restores the first branch's reducer.
    button(root, "flip").click();
    button(root, "act").click();
    expect(app.live?.log).toBe("ABA");
  });

  it("still reuses the element rather than rebuilding it", async () => {
    const app = await loadApp(example);
    const root = freshRoot();
    mount(app, root);

    const before = button(root, "act");
    button(root, "flip").click();
    const afterFlip = button(root, "act");
    // Same DOM node: the swap goes through the patch path, not a rebuild. A rebuild here would discard focus and caret on every conditional swap.
    expect(afterFlip).toBe(before);

    // And a render that changes nothing about the button leaves it alone too.
    button(root, "act").click();
    expect(button(root, "act")).toBe(before);
  });
});

describe("the handler memo is per app instance", () => {
  it("dispatches a click to the instance that owns the clicked tree", async () => {
    const createApp = await loadFactory(counter);
    const a = createApp();
    const b = createApp();
    const rootA = freshRoot();
    const rootB = freshRoot();
    mount(a, rootA);
    mount(b, rootB);

    button(rootA, "+1").click();

    expect(a.live?.count).toBe(1);
    expect(b.live?.count).toBe(0);

    button(rootB, "+1").click();
    button(rootB, "+1").click();

    expect(a.live?.count).toBe(1);
    expect(b.live?.count).toBe(2);
  });
});
