// `kumiki smoke` — runtime verification. Compiles a .kumiki file, mounts it in a
// headless DOM (happy-dom), exercises its UI, and reports failures that check/build
// cannot catch: runtime throws, empty renders, and unhandled rejections.

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compile } from "@kumikijs/compiler";
import {
  nodeEpisodeLogReader,
  nodeRuntimeBundleReader,
  resolveBuiltinIcons,
} from "@kumikijs/compiler/node";
import {
  type AppShape,
  createEpisodeLogger,
  describeDiagnostic,
  type EpisodeLogger,
  runScenario,
  type Scenario,
  type ScenarioReport,
  type SmokeReport,
  smoke,
  type TestResult,
} from "@kumikijs/runtime";

let domReady = false;
export function ensureDom(): void {
  if (domReady) return;
  // Registers window/document/Event/… onto globalThis, overwriting Node's own
  // realm globals (Node 22 ships `Event` / `navigator` etc., and elements only
  // accept events constructed from the DOM realm).
  GlobalRegistrator.register({ url: "http://localhost/" });
  domReady = true;
}

/**
 * Compiled-app shape as returned by codegen — adds the mutable signal slot
 * map (`live`) that the runtime keeps but `AppShape` (the public type) does
 * not expose. Replay reads/resets `live` directly, so callers need to see it.
 */
export type LoadedApp = AppShape & { live: Record<string, unknown> };

export async function loadApp(
  source: string,
  capabilities: string[] = [],
  opts: { includeTests?: boolean; sourcePath?: string } = {},
): Promise<LoadedApp> {
  const baseOpts = {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities,
    includeTests: opts.includeTests === true,
    ...(opts.sourcePath ? { readEpisodeLog: nodeEpisodeLogReader(opts.sourcePath) } : {}),
  } as const;
  const first = compile(source, baseOpts);
  if (first.kind !== "ok") {
    throw new Error(
      `compile failed:\n${first.errors.map((e) => `${e.code} ${e.message}`).join("\n")}`,
    );
  }

  // Two-pass when the source uses `icon(name="...")` literals AND we have a
  // sourcePath to resolve `@kumikijs/icons` from. Falls through silently if
  // the package isn't installed.
  let result = first;
  if (opts.sourcePath && first.usedIcons.length > 0) {
    const registry = await resolveBuiltinIcons(opts.sourcePath);
    if (registry) {
      const subset: Record<string, string> = {};
      for (const name of first.usedIcons) {
        const path = registry[name];
        if (typeof path === "string") subset[name] = path;
      }
      if (Object.keys(subset).length > 0) {
        const second = compile(source, { ...baseOpts, icons: subset });
        if (second.kind === "ok") result = second;
      }
    }
  }

  const patched = result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, "");
  const dir = mkdtempSync(join(tmpdir(), "kumiki-smoke-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);
  await import(pathToFileURL(file).href);
  const app = (globalThis as unknown as { __kumikiApp?: LoadedApp }).__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return app;
}

/** Compile + mount + exercise a Kumiki source string; return the smoke report. */
export async function smokeSource(
  source: string,
  capabilities: string[] = [],
  opts: { sourcePath?: string; diagnosticsAsIssues?: boolean } = {},
): Promise<SmokeReport> {
  ensureDom();
  const app = await loadApp(source, capabilities, opts);
  const doc = (globalThis as unknown as { document: Document }).document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  try {
    return await smoke(app, root, {
      settleMs: 20,
      diagnosticsAsIssues: opts.diagnosticsAsIssues ?? false,
    });
  } finally {
    root.remove();
  }
}

export async function smokeFile(
  path: string,
  capabilities: string[] = [],
  opts: { diagnosticsAsIssues?: boolean } = {},
): Promise<SmokeReport> {
  return smokeSource(readFileSync(path, "utf8"), capabilities, { ...opts, sourcePath: path });
}

/** CLI entry: print a human-readable report and exit non-zero on failure. */
export async function smokeCmd(
  path: string,
  capabilities: string[] = [],
  opts: { diagnosticsAsIssues?: boolean } = {},
): Promise<void> {
  const report = await smokeFile(path, capabilities, opts);
  if (report.ok) {
    console.log(`ok — mounted, rendered, ${report.interactions} interaction(s), no runtime errors`);
    printDiagnostics(report, console.log);
    return;
  }
  console.error(
    `runtime smoke failed (mounted=${report.mounted}, rendered=${report.rendered}, interactions=${report.interactions}):`,
  );
  for (const i of report.issues) {
    console.error(`  [${i.phase}] ${i.message}${i.trigger ? ` (on ${i.trigger})` : ""}`);
  }
  // Same stream as the failure it accompanies, so a caller reading stderr sees
  // the whole picture and stdout stays parseable.
  printDiagnostics(report, console.error);
  process.exit(1);
}

/**
 * Reconcile churn observed while driving the app. Advisory, never fatal — an
 * app that rebuilds more than it needs to still works — so this leaves the exit
 * code alone (pass `--diagnostics-as-issues` to make them count). Summarised by
 * reason rather than listed one per occurrence: a single unkeyed list produces
 * one entry per interaction.
 */
function printDiagnostics(report: SmokeReport, write: (line: string) => void): void {
  if (report.diagnostics.length === 0) return;
  const byReason = new Map<string, number>();
  for (const { diagnostic } of report.diagnostics) {
    // A fallback is summarised by its reason — the kind alone would collapse
    // six distinct causes into one row. Every other kind IS its own reason, and
    // reading the kind rather than naming them keeps a new one from being
    // silently counted as an existing one.
    const label = diagnostic.kind === "reconcile-fallback" ? diagnostic.reason : diagnostic.kind;
    byReason.set(label, (byReason.get(label) ?? 0) + 1);
  }
  const summary = [...byReason]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} ×${n}`)
    .join(", ");
  write(`  reconcile diagnostics: ${summary}`);
}

/** Compile + mount + drive a scenario; return the structured trace. */
export async function runScenarioSource(
  source: string,
  scenario: Scenario,
  capabilities: string[] = [],
  opts: { episodeLogger?: EpisodeLogger | null; sourcePath?: string } = {},
): Promise<ScenarioReport> {
  ensureDom();
  const app = await loadApp(source, capabilities, {
    ...(opts.sourcePath ? { sourcePath: opts.sourcePath } : {}),
  });
  const doc = (globalThis as unknown as { document: Document }).document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  try {
    return await runScenario(app, root, scenario, {
      settleMs: 20,
      episodeLogger: opts.episodeLogger ?? null,
    });
  } finally {
    root.remove();
  }
}

/**
 * Read a scenario document, or fail with a message that names the file.
 *
 * Every failure below used to reach the caller as the raw thrown thing: an
 * `ENOENT` / `EISDIR` from the read, a `SyntaxError` naming a character offset
 * in an unnamed string, or — for a document that parsed but held no `steps` —
 * a `TypeError: scenario.steps is not iterable` thrown from inside the runner,
 * three frames from anything the author wrote. With two paths on the command
 * line, "which file" is the first thing the message has to answer.
 */
function loadScenario(path: string): Scenario {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`could not read scenario ${path}: ${e instanceof Error ? e.message : e}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  const steps = (doc as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) {
    throw new Error(`${path} is not a scenario: it needs a "steps" array`);
  }
  const bad = steps.findIndex((s) => typeof s !== "object" || s === null || Array.isArray(s));
  if (bad !== -1) {
    throw new Error(`${path} is not a scenario: steps[${bad}] is not a step object`);
  }
  return doc as Scenario;
}

/** CLI entry: run a scenario JSON file against a .kumiki file; print the trace. */
export async function runCmd(
  kumikiPath: string,
  scenarioPath: string,
  capabilities: string[] = [],
  opts: { episodeLog?: string } = {},
): Promise<void> {
  const scenario = loadScenario(scenarioPath);
  // Episode log is opt-in: write only when the caller asked for it via the
  // `--episode-log <file>` flag or the `KUMIKI_EPISODE_LOG` env var. This keeps
  // example runs from littering sidecar JSONL next to every .kumiki file. When
  // enabled, the §10.5 runtime episode logger records each trigger → reducer →
  // effect-start → effect-end → signal-update chain into memory; we flush the
  // entire ring to disk after the scenario completes.
  const logFile = opts.episodeLog ?? process.env.KUMIKI_EPISODE_LOG;
  const episodeLogger = logFile ? createEpisodeLogger() : null;
  const report = await runScenarioSource(readFileSync(kumikiPath, "utf8"), scenario, capabilities, {
    episodeLogger,
    sourcePath: kumikiPath,
  });
  for (let i = 0; i < report.steps.length; i++) {
    const s = report.steps[i];
    if (!s) continue;
    const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
    const status = s.errors.length === 0 && s.failures.length === 0 ? "ok" : "FAIL";
    console.log(`[${status}] ${head}`);
    for (const e of s.errors) console.log(`    error: ${e}`);
    for (const e of s.expectedErrors) console.log(`    expected error: ${e}`);
    for (const f of s.failures) console.log(`    assert: ${f}`);
    // Advisory, and attributed to the action above it — that pairing is the
    // whole reason the runner buffers diagnostics per step. Listed rather than
    // summarised here (unlike `kumiki smoke`) because a step produces few.
    for (const d of s.diagnostics) console.log(`    diagnostic: ${describeDiagnostic(d)}`);
  }
  console.log(report.ok ? "\nscenario passed" : "\nscenario FAILED");
  if (episodeLogger && logFile) {
    for (const ep of episodeLogger.list()) {
      appendFileSync(logFile, `${JSON.stringify(ep)}\n`);
    }
  }
  if (!report.ok) process.exit(1);
}

// ----- `kumiki test` — run in-language `test` definitions -----

type TestRunner = { name: string; kind: string; run: () => TestResult };

/** Compile a source with tests included, import it, and run every `test` definition. */
export async function runTestsSource(
  source: string,
  capabilities: string[] = [],
  opts: { sourcePath?: string } = {},
): Promise<TestResult[]> {
  ensureDom();
  await loadApp(source, capabilities, {
    includeTests: true,
    ...(opts.sourcePath ? { sourcePath: opts.sourcePath } : {}),
  });
  const tests = (globalThis as unknown as { __kumikiTests?: TestRunner[] }).__kumikiTests ?? [];
  return tests.map((t) => {
    const t0 = performance.now();
    const r = t.run();
    return { ...r, ms: Math.round(performance.now() - t0) };
  });
}

export async function testFile(path: string, capabilities: string[] = []): Promise<TestResult[]> {
  return runTestsSource(readFileSync(path, "utf8"), capabilities, { sourcePath: path });
}

/** Render a scalar leaf value for the §8.7.1 value arrow (strings get quoted). */
function leafStr(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Match a test name against a filter: exact, or a `prefix-*` / `prefix*` wildcard. */
function matchesFilter(name: string, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter.endsWith("*")) return name.startsWith(filter.slice(0, -1));
  return name === filter;
}

type CoverageCat = { total: string[]; used: string[] };
export type Coverage = { reducers: CoverageCat; tiles: CoverageCat; effects: CoverageCat };

/** Print the §8.7 coverage report (per reducer / effect / tile), listing the uncovered. */
function printCoverage(cov: Coverage): void {
  console.log("\ncoverage");
  for (const [label, cat] of [
    ["reducers", cov.reducers],
    ["effects", cov.effects],
    ["tiles", cov.tiles],
  ] as const) {
    const uncovered = cat.total.filter((n) => !cat.used.includes(n));
    const tail = uncovered.length > 0 ? `  (uncovered: ${uncovered.join(", ")})` : "";
    console.log(`  ${label.padEnd(9)} ${cat.used.length}/${cat.total.length}${tail}`);
  }
}

export type TestReport = {
  /** Test results after applying `filter`. */
  results: TestResult[];
  /** Filter that produced `results`, verbatim (for callers rendering "no tests match …"). */
  filter: string | undefined;
  /** Sum of `results` (post-filter). */
  total: number;
  /** Count of `results[i].pass === true`. */
  passed: number;
  /** `total - passed`. */
  failed: number;
  /** §8.7 coverage snapshot, populated only when `opts.coverage === true`. */
  coverage?: Coverage;
};

/**
 * Pure test runner: compile + mount + run every `test` in `path`, filter by
 * name/prefix, return a structured report. No stdout — printer lives in
 * `testCmd`. `coverage: true` snapshots the runtime coverage bookkeeping
 * (§8.7) that `testFile` populates on the global.
 */
export async function runTests(
  path: string,
  filter: string | undefined,
  capabilities: string[] = [],
  opts: { coverage?: boolean } = {},
): Promise<TestReport> {
  const all = await testFile(path, capabilities);
  const results = all.filter((r) => matchesFilter(r.name, filter));
  const passed = results.filter((r) => r.pass).length;
  const cov =
    opts.coverage === true
      ? (globalThis as unknown as { __kumikiCoverage?: Coverage }).__kumikiCoverage
      : undefined;
  return {
    results,
    filter,
    total: results.length,
    passed,
    failed: results.length - passed,
    ...(cov ? { coverage: cov } : {}),
  };
}

/** Print a `TestReport` in the §8.7.1 format. Returns the failure count. */
function printTestReport(report: TestReport): number {
  if (report.results.length === 0) {
    // A filter that matches nothing is a failure: the caller named tests that
    // are not there, and a renamed test would otherwise leave CI green while
    // running nothing. Having no tests at all when none were asked for is not.
    if (report.filter) {
      console.error(`no tests match "${report.filter}"`);
      return 1;
    }
    console.log("no tests found");
    return 0;
  }
  for (const r of report.results) {
    // §8.7.1 tag: `(1ms)`, or `(100 cases, 23ms)` for a property-test.
    const bits: string[] = [];
    if (r.cases !== undefined) bits.push(`${r.cases} cases`);
    if (r.ms !== undefined) bits.push(`${r.ms}ms`);
    const tag = bits.length > 0 ? ` (${bits.join(", ")})` : "";
    if (r.pass) {
      console.log(`PASS  ${r.name}${tag}`);
      continue;
    }
    console.log(`FAIL  ${r.name}${tag}`);
    if (r.expected !== undefined) console.log(`  expected: ${r.expected}`);
    if (r.actual !== undefined) console.log(`  actual:   ${r.actual}`);
    if (r.diffAt !== undefined) {
      const arrow = r.leaf ? `  ${leafStr(r.leaf.expected)} -> ${leafStr(r.leaf.actual)}` : "";
      console.log(`  diff at:  ${r.diffAt}${arrow}`);
    }
  }
  console.log(`\n${report.passed}/${report.total} passed`);
  if (report.coverage) printCoverage(report.coverage);
  return report.failed;
}

/** CLI entry: run `test` definitions, print the §8.7.1 report, exit non-zero on any failure. */
export async function testCmd(
  path: string,
  filter: string | undefined,
  capabilities: string[] = [],
  opts: { coverage?: boolean; watch?: boolean } = {},
): Promise<void> {
  const runOnce = async (): Promise<number> => {
    const report = await runTests(path, filter, capabilities, { coverage: opts.coverage ?? false });
    return printTestReport(report);
  };
  if (opts.watch) {
    // §8.7: re-run on change. Errors are caught so a transient compile failure
    // doesn't kill the watcher; SIGINT exits cleanly.
    const runSafe = async (): Promise<void> => {
      try {
        await runOnce();
      } catch (e) {
        console.error(`test run failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    await runSafe();
    console.log("\nwatching for changes… (Ctrl-C to stop)");
    const { watch } = await import("node:fs");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = watch(path, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        console.log("\n— change detected —");
        void runSafe();
      }, 100);
    });
    process.on("SIGINT", () => {
      watcher.close();
      console.log("\nwatch stopped");
      process.exit(0);
    });
    await new Promise<never>(() => {});
    return;
  }
  const failed = await runOnce();
  if (failed > 0) process.exit(1);
}
