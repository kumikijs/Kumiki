// Reactivity re-render cost (issue #159 AC2 → #187 keyed diff → #190 patch).
//
// Measures how many DOM element nodes the runtime CREATES per single-slot
// update. Under the pre-#187 model this was the whole tree every time (a
// `target.replaceChild` swap); under the current tile-level keyed diff
// (walker + prop equality kernel live inline in `packages/runtime/src/core.ts`
// under the `// ---- tile-level keyed diff ----` section — see
// docs/design/reactivity-v2.md §2 Decision 1(a)) only rebuilt subtrees create
// new nodes. #190's identity-preserving patch drops the rebuild for tiles
// whose kind is unchanged, so a leaf-only text change now creates ZERO new
// elements — the mounted `<h1>` gets `.textContent = "Count: N"` in place
// instead of a fresh `createElement`. `waste×` is `created ÷ changed`; the
// #190 target is 0× (nothing added, one text node mutated).
//
// happy-dom is cheaper than a real browser (no layout/style recalc, no
// listener reattach), so absolute wall-clock here is a floor — the shape
// (waste× drops sharply, µs/node drops as unnecessary work disappears) is
// what matters, not the absolute numbers.
//
// Run:
//   pnpm --filter @kumikijs/benchmarks measure:reactivity

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { isUnstable, median, summarize } from "./stats.mjs";

const TILE_COUNTS = [10, 50, 200, 500];
const WARMUP = 20;
const ITERATIONS = 200;
// A row whose p90 exceeds its median by this factor is reported as untrustworthy
// (see `isUnstable` in ./stats.mjs for why the tail, not the stddev, is the test).
const UNSTABLE_TAIL_FACTOR = 3;

// Register happy-dom onto globalThis (window/document/Event/…), exactly like
// `packages/cli/src/smoke.ts:ensureDom`. Elements only accept events built from
// the DOM realm, so this must run before any mount.
GlobalRegistrator.register({ url: "http://localhost/" });

const { mount } = await import("@kumikijs/runtime");
const doc = /** @type {Document} */ (globalThis.document);

/**
 * Generate a Kumiki app whose `App` tile is a column of `rows` static text
 * tiles plus one heading bound to the `count` slot. Bumping `count` changes a
 * single text node — the theoretical minimum — so the diff should rebuild
 * only the heading subtree and leave every sibling row untouched.
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

/**
 * Mount an app of `rows` size, then time single-slot updates and count DOM
 * element additions per update via a MutationObserver on the mount root. The
 * observer sees only nodes the diff actually created — under the current
 * keyed-diff model, that's just the rebuilt subtree of the changed tile.
 * @param {number} rows
 */
async function measure(rows) {
  const app = await loadApp(makeSource(rows));
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const handle = mount(app, root);

  const initialNodes = root.querySelectorAll("*").length;

  const rerender = app._rerender;
  if (typeof rerender !== "function") throw new Error("app._rerender missing after mount");

  // Observer counts Element nodes added to the mount subtree since the last
  // reset. `characterData` mutations (pure text swaps) do not create Elements
  // so are excluded — this matches the metric's definition of "nodes created".
  let createdThisUpdate = 0;
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        if (n.nodeType === 1) createdThisUpdate += 1 + countDescendantElements(n);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  let n = 0;
  for (let i = 0; i < WARMUP; i++) {
    app.live.count = ++n;
    rerender();
  }
  // Drain any pending observer records from warmup before the timed loop.
  observer.takeRecords();

  const samples = [];
  const created = [];
  for (let i = 0; i < ITERATIONS; i++) {
    app.live.count = ++n;
    createdThisUpdate = 0;
    const t0 = performance.now();
    rerender();
    samples.push(performance.now() - t0);
    // Flush any records the observer batched — happy-dom fires the callback
    // synchronously, but taking pending records makes the accounting exact.
    for (const rec of observer.takeRecords()) {
      for (const nn of rec.addedNodes) {
        if (nn.nodeType === 1) createdThisUpdate += 1 + countDescendantElements(nn);
      }
    }
    created.push(createdThisUpdate);
  }

  observer.disconnect();
  handle.dispose();
  root.remove();

  // Timings get the full distribution (median + tail + spread): they are a
  // small-N wall-clock measurement, so a median alone cannot say whether the
  // run is trustworthy. `created` stays median-only — it is an integer
  // invariant of the diff, not a timing statistic.
  const timing = summarize(samples);
  const medCreated = median(created);
  // #190 identity-preserving patch: a single-slot leaf-text change lands as
  // an in-place `.textContent = ...` on the mounted `<h1>` — no
  // `createElement`, no `replaceChild`, so `medCreated === 0` is now the
  // expected outcome. Pre-#190 the invariant was `>= 1` (the rebuilt
  // heading subtree); reverting to that would fail the very optimization
  // this benchmark exists to demonstrate. Regressions we still want to
  // catch loudly show up as `medCreated >> 0` on the WASTE side, and as a
  // rerender ms that decouples from tile count — both still surfaced.
  // One update changes exactly one text node ("Count: N"): the semantic
  // minimum. Under the keyed diff this manifests as rebuilding the heading
  // subtree (heading element + its inner text container) — a small constant.
  const nodesChanged = 1;
  return {
    tiles: rows,
    initialNodes,
    nodesCreatedPerUpdate: medCreated,
    nodesChanged,
    wasteRatio: medCreated / nodesChanged,
    renderMedianMs: timing.median,
    renderP90Ms: timing.p90,
    renderStddevMs: timing.stddev,
    renderMinMs: timing.min,
    renderMaxMs: timing.max,
    usPerCreated: medCreated > 0 ? (timing.median * 1000) / medCreated : 0,
  };
}

/** Recursive Element-descendant count for a freshly-attached node. */
function countDescendantElements(node) {
  if (node.nodeType !== 1) return 0;
  return /** @type {Element} */ (node).querySelectorAll("*").length;
}

const rows = [];
for (const n of TILE_COUNTS) rows.push(await measure(n));

// ----- report -----

const headers = [
  "tiles",
  "initial DOM",
  "created/upd",
  "changed",
  "waste×",
  "median ms",
  "p90 ms",
  "stddev",
  "min ms",
  "max ms",
  "µs/created",
];
const cells = rows.map((r) => [
  String(r.tiles),
  String(r.initialNodes),
  String(r.nodesCreatedPerUpdate),
  String(r.nodesChanged),
  `${r.wasteRatio.toFixed(1)}×`,
  r.renderMedianMs.toFixed(3),
  r.renderP90Ms.toFixed(3),
  r.renderStddevMs.toFixed(3),
  r.renderMinMs.toFixed(3),
  r.renderMaxMs.toFixed(3),
  r.usPerCreated.toFixed(2),
]);
const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
const line = (c) => c.map((v, i) => v.padStart(widths[i])).join("  ");
console.log(
  "\nReactivity re-render cost — tile-level keyed diff (#187) + identity-preserving patch (#190)\n",
);
console.log(line(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const c of cells) console.log(line(c));
console.log("\n`created/upd` = Elements added to the DOM per single-slot update, measured");
console.log("by MutationObserver. `changed` is the semantic minimum (one text node).");
console.log("`waste×` = created ÷ changed; a perfect fine-grained model would land at 1×.");
console.log("`median ms` / `p90 ms` / `stddev` / `min ms` / `max ms` all describe the same sample");
console.log("of per-update timings. Read them together: a real regression moves the median and");
console.log("p90 together, while a busy machine moves only the tail. `stddev` is dominated by");
console.log("isolated GC pauses — a single one is enough to swamp it, so treat it as a tail");
console.log("indicator, not as an error bar around the median.\n");

// A run whose tail has detached from its body measured the machine, not the
// runtime. Say so on stderr rather than letting the reader trust the numbers:
// stdout stays a clean report + JSON blob even when this fires.
const unstable = rows.filter((r) =>
  isUnstable({ median: r.renderMedianMs, p90: r.renderP90Ms }, UNSTABLE_TAIL_FACTOR),
);
if (unstable.length > 0) {
  const where = unstable.map((r) => r.tiles).join(", ");
  console.warn(
    `⚠ unstable timings at tiles ${where}: p90 is more than ${UNSTABLE_TAIL_FACTOR}× the median, ` +
      `so this run measured machine noise as much as runtime work. Re-run on an idle machine, ` +
      `or raise ITERATIONS (currently ${ITERATIONS}).`,
  );
}

console.log(
  JSON.stringify(
    {
      benchmark: "reactivity-cost",
      model: "tile-level keyed diff + identity-preserving patch",
      warmup: WARMUP,
      iterations: ITERATIONS,
      rows,
    },
    null,
    2,
  ),
);
