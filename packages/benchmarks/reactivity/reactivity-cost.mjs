// Reactivity re-render cost.
//
// Measures how many DOM element nodes the runtime CREATES per single-slot
// update. The original runtime rebuilt the whole tree every time (a
// `target.replaceChild` swap); the tile-level keyed diff that replaced it
// (walker + prop equality kernel live inline in `packages/runtime/src/core.ts`
// under the `// ---- tile-level keyed diff ----` section — see
// docs/design/reactivity-v2.md §2 Decision 1(a)) rebuilds only changed
// subtrees, and the identity-preserving patch layered on top drops even that
// for tiles whose kind is unchanged: a leaf-only text change creates ZERO new
// elements, because the mounted `<h1>` gets `.textContent = "Count: N"` in
// place instead of a fresh `createElement`. `waste×` is `created ÷ changed`;
// the target is 0× (nothing added, one text node mutated).
//
// happy-dom is cheaper than a real browser (no layout/style recalc, no
// listener reattach), so absolute wall-clock here is a floor — the shape
// (waste× drops sharply, render time decouples from tile count) is what
// matters, not the absolute numbers.
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
 * single text node — the theoretical minimum — so the reconcile should touch
 * the heading's text and leave every sibling row untouched.
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
 * observer sees only nodes the reconcile actually created: subtrees it had to
 * rebuild, and nothing at all when it can patch a mounted node in place.
 * @param {number} rows
 */
async function measure(rows) {
  const app = await loadApp(makeSource(rows));
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  const handle = mount(app, root);

  const initialNodes = root.querySelectorAll("*").length;
  // An app that mounts nothing would still produce a full table of timings for
  // a benchmark measuring nothing at all. The generated tree carries one
  // element per row plus the heading and the button, so anything under `rows`
  // means the mount, not the diff, is what broke.
  if (initialNodes < rows) {
    throw new Error(`mount rendered ${initialNodes} elements for ${rows} rows — app did not mount`);
  }

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
  // The semantic minimum: one update changes exactly one text node
  // ("Count: N"). This is the constant `created` is measured against, not a
  // measurement itself. Under the identity-preserving patch the update lands
  // as an in-place `.textContent = ...` on the mounted `<h1>` — no
  // `createElement`, no `replaceChild` — so a healthy run creates FEWER nodes
  // than the minimum it changes (`medCreated === 0`, `waste× === 0`). A
  // regression shows up as `medCreated` climbing back above zero, and as a
  // render time that recouples to tile count.
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
    // Undefined, not zero, when the update creates nothing: `0.00` in the
    // report would read as "infinitely cheap per node" when the truth is that
    // there are no created nodes to divide by.
    usPerCreated: medCreated > 0 ? (timing.median * 1000) / medCreated : null,
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
  r.usPerCreated === null ? "—" : r.usPerCreated.toFixed(2),
]);
const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
const line = (c) => c.map((v, i) => v.padStart(widths[i])).join("  ");
console.log("\nReactivity re-render cost — tile-level keyed diff + identity-preserving patch\n");
console.log(line(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const c of cells) console.log(line(c));
console.log("\n`created/upd` = Elements added to the DOM per single-slot update, measured");
console.log("by MutationObserver. `changed` is the semantic minimum (one text node).");
console.log("`waste×` = created ÷ changed; a perfect fine-grained model would land at 1×.");
console.log("`µs/created` is undefined — printed `—` — when an update creates no nodes at all,");
console.log("which is the current model's expected outcome.");
console.log("`median ms` / `p90 ms` / `stddev` / `min ms` / `max ms` all describe the same sample");
console.log(
  "of per-update timings. Read them together: a regression that slows every update moves",
);
console.log("the median and the tail together, while a busy machine moves only the tail. `stddev`");
console.log("is dominated by isolated GC pauses — a single one is enough to swamp it, so treat it");
console.log("as a tail indicator, not as an error bar around the median.\n");

// A detached tail is reported, not diagnosed: this harness cannot tell a busy
// machine from a slow path that only a minority of updates take, and saying
// "noise" would train the reader to dismiss the second. Goes to stderr so
// stdout stays a clean report + JSON blob even when it fires.
const unstable = rows.filter((r) =>
  isUnstable({ median: r.renderMedianMs, p90: r.renderP90Ms }, UNSTABLE_TAIL_FACTOR),
);
if (unstable.length > 0) {
  const detail = unstable
    .map(
      (r) =>
        `${r.tiles} tiles (p90 ${r.renderP90Ms.toFixed(3)} ms = ` +
        `${(r.renderP90Ms / r.renderMedianMs).toFixed(1)}×)`,
    )
    .join(", ");
  console.warn(
    `⚠ tail detached from the body — p90 over ${UNSTABLE_TAIL_FACTOR}× the median at ${detail}. ` +
      `Either the machine was busy, or a minority of updates genuinely takes that long. ` +
      `Re-run on an idle machine (or raise ITERATIONS, currently ${ITERATIONS}) to tell them ` +
      `apart: a ratio that survives an idle re-run is a real slow path, not noise.`,
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
