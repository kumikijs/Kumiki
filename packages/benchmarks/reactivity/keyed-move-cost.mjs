// Keyed reorder cost.
//
// Measures how many mounted children the runtime MOVES to produce a new order.
// Matching children by key (docs/spec/runtime.md §10.3.10) says which old
// element belongs to which new child; it does not by itself say how many of
// them have to be touched. The reorder phase used to replay the whole target
// sequence with `appendChild`, so every render reaching the keyed path detached
// and re-attached every child — N moves for a list where nothing moved at all.
// It now leaves the survivors whose old positions already ascend where they are
// and inserts only the rest, so the count tracks what actually changed.
//
// `sweep` is that previous behaviour, kept as the column to read `moves`
// against: it is the length of the new child list, which is what replaying the
// sequence costs by construction. It is a constant, not a measurement.
//
// Why this is not counted with a MutationObserver like `reactivity-cost.mjs`:
// that benchmark counts NODES the runtime created, and a node is what an
// observer reports. A move is an OPERATION on a node that already exists, so it
// is counted where it happens — the container's own `insertBefore` /
// `appendChild` / `removeChild`.
//
// happy-dom is cheaper than a real browser (no layout/style recalc, no listener
// reattach), so the wall-clock here is a floor. The move counts are exact: they
// are integer properties of the diff, not timings.
//
// One caveat the timings carry, and the reason `moves` is the headline: placing
// a child against a successor uses `insertBefore`, and happy-dom implements it
// by scanning its child array for the reference node — O(n) per call where
// `appendChild` is a push. A transition that has to move nearly everything
// (`reverse`) therefore reads SLOWER here than the sweep it replaced, while
// making one fewer move. That is a property of the fake DOM's child storage,
// not of the algorithm; browsers index their children. Read the timings for the
// transitions that got cheaper by not touching untouched children, and read
// `moves` for the rest.
//
// Run:
//   pnpm --filter @kumikijs/benchmarks measure:keyed-moves

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import { isUnstable, median, summarize } from "./stats.mjs";

const LIST_SIZES = [50, 200, 500];
const WARMUP = 10;
const ITERATIONS = 100;
const UNSTABLE_TAIL_FACTOR = 3;

GlobalRegistrator.register({ url: "http://localhost/" });

const { mount } = await import("@kumikijs/runtime");
const doc = /** @type {Document} */ (globalThis.document);

/**
 * The transitions worth separating. Each takes the base list and returns the
 * list the measured render produces; the render back to base is untimed setup.
 *
 * `minimum` is what an optimal reorder costs for that transition, derived by
 * hand so the table states an expectation rather than only reporting a number:
 * a mount or a removal addresses its own element and is not a move.
 */
const SCENARIOS = [
  {
    name: "unchanged",
    of: (base) => base.slice(),
    minimum: () => 0,
    note: "re-render with the same order",
  },
  {
    name: "move one",
    of: (base) => [base[base.length - 1], ...base.slice(0, -1)],
    minimum: () => 1,
    note: "last item to the front",
  },
  {
    name: "insert head",
    of: (base) => ["fresh", ...base],
    minimum: () => 0,
    note: "one newcomer, no survivor displaced",
  },
  {
    name: "remove middle",
    of: (base) => [...base.slice(0, base.length >> 1), ...base.slice((base.length >> 1) + 1)],
    minimum: () => 0,
    note: "one departure, no survivor displaced",
  },
  {
    name: "reverse",
    of: (base) => base.slice().reverse(),
    minimum: (n) => n - 1,
    note: "no two children keep their relative order",
  },
];

/**
 * A keyed list under a plain container — the shape §10.3.10 asks for. The `for`
 * gives every row the implicit `_s.show(r)` key, and `Rows` holds nothing but
 * the loop so the container is exactly the parent the keyed pass addresses.
 */
function makeSource() {
  return [
    "slot rows : List(Text) = []",
    "tile Rows = column(for r in rows text(r) {key: r})",
    "tile App = column(Rows)",
    "app KeyedMoveBench",
    "  caps = []",
    '  routes = {"/" -> App, "/404" -> App}',
    "  init = []",
  ].join("\n");
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
  const dir = mkdtempSync(join(tmpdir(), "kumiki-keyed-move-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);
  await import(pathToFileURL(file).href);
  const app = globalThis.__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return app;
}

/**
 * Wrap the container's child-mutation methods and tally what the reconciler
 * does through them. A placement of a node the container already held is a
 * MOVE; anything else is a mount. `.reset()` starts a fresh tally so the
 * untimed setup render is not counted.
 * @param {HTMLElement} container
 */
function tallyChildOps(container) {
  const counts = { moves: 0, mounts: 0, removes: 0 };
  const insertBefore = container.insertBefore.bind(container);
  const appendChild = container.appendChild.bind(container);
  const removeChild = container.removeChild.bind(container);
  container.insertBefore = (node, ref) => {
    if (node.parentNode === container) counts.moves += 1;
    else counts.mounts += 1;
    return insertBefore(node, ref);
  };
  container.appendChild = (node) => {
    if (node.parentNode === container) counts.moves += 1;
    else counts.mounts += 1;
    return appendChild(node);
  };
  container.removeChild = (node) => {
    counts.removes += 1;
    return removeChild(node);
  };
  return {
    counts,
    reset() {
      counts.moves = 0;
      counts.mounts = 0;
      counts.removes = 0;
    },
  };
}

/**
 * Mount a list of `size` keyed rows and measure one scenario's transition.
 * @param {number} size
 * @param {(typeof SCENARIOS)[number]} scenario
 */
async function measure(size, scenario) {
  const app = await loadApp(makeSource());
  const base = Array.from({ length: size }, (_, i) => `row-${i}`);
  const target = scenario.of(base);
  const root = doc.createElement("div");
  doc.body.appendChild(root);

  // A silent fallback out of the keyed path would produce a full table of
  // move counts for a run that never took the path being measured. `smoke` and
  // `kumiki dev` read the same channel (§10.3.12).
  const fallbacks = [];
  const handle = mount(app, root, {
    onDiagnostic: (d) => {
      if (d.kind === "reconcile-fallback") fallbacks.push(d.reason);
    },
  });

  const rerender = app._rerender;
  if (typeof rerender !== "function") throw new Error("app._rerender missing after mount");

  // First fill crosses the empty boundary (§10.3.10), which re-enters the
  // container's renderer rather than taking the keyed path. Do it before the
  // container is instrumented so it cannot be mistaken for a reorder.
  app.live.rows = base;
  rerender();
  // `App` is a column holding `Rows`, which is a column holding the loop, so
  // the parent the keyed pass addresses is the mount root's grandchild. Its
  // child count is asserted against the list rather than assumed: a shape drift
  // here would silently measure the wrong element.
  const container = root.firstElementChild?.firstElementChild;
  if (!container || container.children.length !== size) {
    throw new Error(
      `expected the rows container to hold ${size} rows, found ${container?.children.length ?? "no container"}`,
    );
  }

  const tally = tallyChildOps(container);
  const run = () => {
    app.live.rows = base;
    rerender();
    tally.reset();
    app.live.rows = target;
    const t0 = performance.now();
    rerender();
    return performance.now() - t0;
  };

  for (let i = 0; i < WARMUP; i++) run();

  const samples = [];
  const moves = [];
  const mounts = [];
  const removes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    samples.push(run());
    moves.push(tally.counts.moves);
    mounts.push(tally.counts.mounts);
    removes.push(tally.counts.removes);
    if (container.children.length !== target.length) {
      throw new Error(
        `after "${scenario.name}" the container holds ${container.children.length} rows, expected ${target.length}`,
      );
    }
  }

  handle.dispose();
  root.remove();

  if (fallbacks.length > 0) {
    throw new Error(
      `the keyed path was declined during "${scenario.name}" at ${size}: ${[...new Set(fallbacks)].join(", ")}`,
    );
  }

  const timing = summarize(samples);
  return {
    size,
    scenario: scenario.name,
    note: scenario.note,
    moves: median(moves),
    mounts: median(mounts),
    removes: median(removes),
    minimumMoves: scenario.minimum(size),
    // What replaying the target sequence with `appendChild` costs: one
    // placement per new child, whatever the order turned out to be.
    sweepMoves: target.length,
    renderMedianMs: timing.median,
    renderP90Ms: timing.p90,
    renderStddevMs: timing.stddev,
  };
}

const rows = [];
for (const size of LIST_SIZES) {
  for (const scenario of SCENARIOS) rows.push(await measure(size, scenario));
}

// ----- report -----

const headers = [
  "list",
  "scenario",
  "moves",
  "minimum",
  "sweep",
  "mounts",
  "removes",
  "median ms",
  "p90 ms",
  "stddev",
];
const cells = rows.map((r) => [
  String(r.size),
  r.scenario,
  String(r.moves),
  String(r.minimumMoves),
  String(r.sweepMoves),
  String(r.mounts),
  String(r.removes),
  r.renderMedianMs.toFixed(3),
  r.renderP90Ms.toFixed(3),
  r.renderStddevMs.toFixed(3),
]);
const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
const line = (c) => c.map((v, i) => v.padStart(widths[i])).join("  ");
console.log("\nKeyed reorder cost — how many mounted children a new order costs\n");
console.log(line(headers));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const c of cells) console.log(line(c));
console.log("\n`moves` = mounted children re-placed in the container per render, counted at the");
console.log("container's own insertBefore / appendChild. `minimum` is what the transition costs");
console.log("at best, derived by hand — `moves` above it is waste. `sweep` is what replaying the");
console.log("whole target sequence costs (one placement per new child), the behaviour this");
console.log("replaced. `mounts` and `removes` address elements that are arriving or leaving and");
console.log("are not moves; they are shown so a zero in `moves` is readable as 'nothing that was");
console.log("already on the page was touched' rather than 'nothing happened'.");
console.log("The timings are happy-dom's, and its `insertBefore` scans the child array for the");
console.log("reference node where `appendChild` pushes. A transition moving nearly everything");
console.log("(`reverse`) therefore reads slower here than the sweep it replaced while making one");
console.log("fewer move — a property of the fake DOM's child storage, not of the algorithm.\n");

const offBy = rows.filter((r) => r.moves !== r.minimumMoves);
if (offBy.length > 0) {
  const detail = offBy.map((r) => `${r.size}/${r.scenario} (${r.moves} vs ${r.minimumMoves})`);
  console.warn(`⚠ moves above the minimum at: ${detail.join(", ")}`);
}

const unstable = rows.filter((r) =>
  isUnstable({ median: r.renderMedianMs, p90: r.renderP90Ms }, UNSTABLE_TAIL_FACTOR),
);
if (unstable.length > 0) {
  const detail = unstable
    .map(
      (r) =>
        `${r.size}/${r.scenario} (p90 ${r.renderP90Ms.toFixed(3)} ms = ` +
        `${(r.renderP90Ms / r.renderMedianMs).toFixed(1)}×)`,
    )
    .join(", ");
  console.warn(
    `⚠ tail detached from the body — p90 over ${UNSTABLE_TAIL_FACTOR}× the median at ${detail}. ` +
      `Either the machine was busy, or a minority of renders genuinely takes that long. ` +
      `Re-run on an idle machine (or raise ITERATIONS, currently ${ITERATIONS}) to tell them ` +
      `apart: a ratio that survives an idle re-run is a real slow path, not noise.`,
  );
}

console.log(
  JSON.stringify(
    { benchmark: "keyed-move-cost", warmup: WARMUP, iterations: ITERATIONS, rows },
    null,
    2,
  ),
);
