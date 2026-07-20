// Reactivity re-render cost (issue #159 AC2 → #187 keyed diff).
//
// Measures how many DOM element nodes the runtime CREATES per single-slot
// update. Under the pre-#187 model this was the whole tree every time (a
// `target.replaceChild` swap); under the current tile-level keyed diff
// (walker + prop equality kernel live inline in `packages/runtime/src/core.ts`
// under the `// ---- tile-level keyed diff (issue #187) ----` section — see
// docs/design/reactivity-v2.md §2 Decision 1(a)) only rebuilt subtrees create
// new nodes, so a leaf-only change should create ~1 element. The `waste×`
// column is `nodes created ÷ nodes changed`; a perfect fine-grained model
// would land at 1×.
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

/** Median of a numeric array (mutates a copy). @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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

  const medMs = median(samples);
  const medCreated = median(created);
  // Invariant: a single-slot leaf change MUST create ≥1 Element (the rebuilt
  // heading subtree). If we see 0, the MutationObserver never fired or the
  // observe target detached — either way the metric would silently report
  // `waste× 0×` / `0.00 µs/created` as "perfect", masking the regression the
  // benchmark exists to catch. Fail loud instead.
  if (!(medCreated >= 1)) {
    throw new Error(
      `reactivity benchmark: expected medCreated >= 1 for ${rows} tiles, got ${medCreated} — MutationObserver never observed the diff's element addition`,
    );
  }
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
    renderMedianMs: medMs,
    usPerCreated: medCreated > 0 ? (medMs * 1000) / medCreated : 0,
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
  "µs/created",
];
const cells = rows.map((r) => [
  String(r.tiles),
  String(r.initialNodes),
  String(r.nodesCreatedPerUpdate),
  String(r.nodesChanged),
  `${r.wasteRatio.toFixed(1)}×`,
  r.renderMedianMs.toFixed(3),
  r.usPerCreated.toFixed(2),
]);
const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
const line = (c) => c.map((v, i) => v.padStart(widths[i])).join("  ");
console.log("\nReactivity re-render cost — tile-level keyed diff (#187, structural fallback)\n");
console.log(line(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const c of cells) console.log(line(c));
console.log("\n`created/upd` = Elements added to the DOM per single-slot update, measured");
console.log("by MutationObserver. `changed` is the semantic minimum (one text node).");
console.log("`waste×` = created ÷ changed; a perfect fine-grained model would land at 1×.\n");

console.log(
  JSON.stringify(
    {
      benchmark: "reactivity-cost",
      model: "keyed diff (structural fallback, #187)",
      warmup: WARMUP,
      iterations: ITERATIONS,
      rows,
    },
    null,
    2,
  ),
);
