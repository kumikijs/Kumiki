// Reactivity re-render cost baseline (issue #159, AC2).
//
// Measures the CURRENT coarse-grained runtime model: every state change tears
// the whole tile tree down and rebuilds it (`core.ts` `render()` →
// `pickRootTile` → `tileCtx.render` → `target.replaceChild`). A single-slot
// update recreates EVERY DOM node even though only one text node semantically
// changes. This harness quantifies that waste across app sizes so a future
// fine-grained model (reactivity-v2) has a numeric baseline to beat.
//
// Same shape as `size-comparison/scripts/*.mjs`: a tsx-run .mjs that prints a
// monospace table + a `generatedAt` JSON blob. Run:
//   pnpm --filter @kumikijs/benchmarks measure:reactivity

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";

const TILE_COUNTS = [10, 50, 200, 500];
const WARMUP = 20;
const ITERATIONS = 200;

// Register happy-dom onto globalThis (window/document/Event/…), exactly like
// `packages/cli/src/smoke.ts:ensureDom`. Elements only accept events built from
// the DOM realm, so this must run before any mount.
GlobalRegistrator.register({ url: "http://localhost/" });

const { mount } = await import("@kumikijs/runtime");
const doc = /** @type {Document} */ (globalThis.document);

/**
 * Generate a Kumiki app whose `App` tile is a column of `rows` static text
 * tiles plus one heading bound to the `count` slot. Bumping `count` changes a
 * single text node — the theoretical minimum — while the coarse model rebuilds
 * the entire subtree.
 * @param {number} rows
 */
function makeSource(rows) {
  const lines = [];
  lines.push("type N = nominal Int where between(0, 999999)");
  lines.push("slot count : N = 0");
  lines.push("reducer bump on=ui.click(Bump) do= count := count + 1");
  lines.push('tile Bump = button(text="bump")');
  const children = ['heading("Count: " + count)'];
  for (let i = 0; i < rows; i++) children.push(`text("row ${i}")`);
  children.push("Bump");
  lines.push(`tile App = column(\n  ${children.join(",\n  ")})`);
  lines.push("app Bench");
  lines.push("  caps = []");
  lines.push('  routes = {"/" -> App, "/404" -> App}');
  lines.push("  init = []");
  return lines.join("\n");
}

/**
 * Compile a source to a bundled module and load its `__kumikiApp`, mirroring
 * `packages/cli/src/smoke.ts:loadApp`: strip the emitted `mount(...)` call so we
 * drive the lifecycle ourselves.
 * @param {string} source
 */
async function loadApp(source) {
  const result = compile(source, {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities: [],
  });
  if (result.kind !== "ok") {
    const detail = result.errors.map((e) => `${e.code} ${e.message}`).join("\n");
    throw new Error(`compile failed:\n${detail}`);
  }
  const patched = result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, "");
  const dir = mkdtempSync(join(tmpdir(), "kumiki-reactivity-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);
  await import(pathToFileURL(file).href);
  const app = globalThis.__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return app;
}

/** Median of a numeric array (mutates a copy). @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Mount an app of `rows` size, then time single-slot updates that each force a
 * full-tree rebuild via the runtime-injected `_rerender`.
 * @param {number} rows
 */
async function measure(rows) {
  const app = await loadApp(makeSource(rows));
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const handle = mount(app, root);

  // Total element nodes recreated on each full rebuild.
  const nodesRecreated = root.querySelectorAll("*").length;

  const rerender = app._rerender;
  if (typeof rerender !== "function") throw new Error("app._rerender missing after mount");

  let n = 0;
  for (let i = 0; i < WARMUP; i++) {
    app.live.count = ++n;
    rerender();
  }
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    app.live.count = ++n;
    const t0 = performance.now();
    rerender();
    samples.push(performance.now() - t0);
  }

  handle.dispose();
  root.remove();

  const medMs = median(samples);
  // One update changes exactly one text node ("Count: N"): the semantic minimum.
  const nodesChanged = 1;
  return {
    tiles: rows,
    nodesRecreated,
    nodesChanged,
    wasteRatio: nodesRecreated / nodesChanged,
    renderMedianMs: medMs,
    usPerNode: (medMs * 1000) / nodesRecreated,
  };
}

const rows = [];
for (const n of TILE_COUNTS) rows.push(await measure(n));

// ----- report -----

const headers = ["tiles", "nodes/render", "changed", "waste×", "median ms", "µs/node"];
const cells = rows.map((r) => [
  String(r.tiles),
  String(r.nodesRecreated),
  String(r.nodesChanged),
  `${r.wasteRatio.toFixed(0)}×`,
  r.renderMedianMs.toFixed(3),
  r.usPerNode.toFixed(2),
]);
const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
const line = (c) => c.map((v, i) => v.padStart(widths[i])).join("  ");
console.log("\nReactivity re-render cost — current coarse model (full teardown + replace)\n");
console.log(line(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const c of cells) console.log(line(c));
console.log("\nEvery single-slot update recreates the whole tree; `changed` is the semantic");
console.log("minimum (one text node). `waste×` = nodes recreated per node changed.\n");

console.log(
  JSON.stringify(
    {
      benchmark: "reactivity-cost",
      model: "coarse: full teardown + replaceChild",
      warmup: WARMUP,
      iterations: ITERATIONS,
      rows,
    },
    null,
    2,
  ),
);
