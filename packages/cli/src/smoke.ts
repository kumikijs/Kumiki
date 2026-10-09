import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, type KumikiError } from "@kumikijs/compiler";
import { nodeEpisodeLogReader, nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
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
import { formatDiagnostic } from "./diagnostic.ts";
import {
  clearStorage,
  type HttpFixture,
  installTestDoubles,
  readHttpFixture,
  useHttpFixture,
} from "./harness.ts";
import { builtinIconSubset } from "./icons.ts";
import { loadSource } from "./store.ts";
import { messageOf } from "./text.ts";

let domReady: Promise<void> | null = null;
export function ensureDom(): Promise<void> {
  domReady ??= registerDom().catch((err: unknown) => {
    // A failed import must not poison every later call.
    domReady = null;
    throw err;
  });
  return domReady;
}

async function registerDom(): Promise<void> {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost/" });
  installTestDoubles();
}

export type LoadedApp = AppShape & { live: Record<string, unknown> };

export async function loadApp(
  source: string,
  capabilities: string[] = [],
  opts: { includeTests?: boolean; sourcePath?: string; moduleDir?: string } = {},
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
    throw new Error(compileFailure(source, [...first.warnings, ...first.errors], opts.sourcePath));
  }

  let result = first;
  const icons = opts.sourcePath ? await builtinIconSubset(opts.sourcePath, first.usedIcons) : null;
  if (icons) {
    const second = compile(source, { ...baseOpts, icons });
    if (second.kind === "ok") result = second;
  }

  const patched = result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, "");
  const dir = mkdtempSync(join(opts.moduleDir ?? tmpdir(), "kumiki-smoke-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);
  await import(pathToFileURL(file).href);
  const app = (globalThis as unknown as { __kumikiApp?: LoadedApp }).__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return app;
}

function compileFailure(source: string, diagnostics: KumikiError[], sourcePath?: string): string {
  // `compile` returned diagnostics rather than throwing, so the source parsed.
  const tests = loadSource(source).defs.filter((e) => e.layer === "test");
  const lines = diagnostics.map((d) => {
    const test = tests.find(
      ({ range }) => d.pos.line >= range.startLine && d.pos.line <= range.endLine,
    );
    return `${formatDiagnostic(d)}${test ? ` (in test "${test.name}")` : ""}`;
  });
  return `compile failed${sourcePath ? ` (${sourcePath})` : ""}:\n${lines.join("\n")}`;
}

/** Compile + mount + exercise a Kumiki source string; return the smoke report. */
export async function smokeSource(
  source: string,
  capabilities: string[] = [],
  opts: {
    sourcePath?: string;
    diagnosticsAsIssues?: boolean;
    /** Overrides the fixture read from `sourcePath`; for a source with no file. */
    httpFixture?: HttpFixture | null;
    /** Milliseconds to settle after each step. Default 20, as the CLI drives it. */
    settleMs?: number;
  } = {},
): Promise<SmokeReport> {
  await ensureDom();
  clearStorage();
  useHttpFixture(
    opts.httpFixture !== undefined
      ? opts.httpFixture
      : opts.sourcePath
        ? readHttpFixture(opts.sourcePath)
        : null,
  );
  const app = await loadApp(source, capabilities, opts);
  return inFreshRoot((root) =>
    smoke(app, root, {
      settleMs: opts.settleMs ?? 20,
      diagnosticsAsIssues: opts.diagnosticsAsIssues ?? false,
    }),
  );
}

async function inFreshRoot<T>(run: (root: HTMLElement) => Promise<T>): Promise<T> {
  const doc = (globalThis as unknown as { document: Document }).document;
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  try {
    return await run(root);
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
  printDiagnostics(report, console.error);
  process.exit(1);
}

function printDiagnostics(report: SmokeReport, write: (line: string) => void): void {
  if (report.diagnostics.length === 0) return;
  const byReason = new Map<string, number>();
  for (const { diagnostic } of report.diagnostics) {
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
  await ensureDom();
  clearStorage();
  useHttpFixture(opts.sourcePath ? readHttpFixture(opts.sourcePath) : null);
  const app = await loadApp(source, capabilities, {
    ...(opts.sourcePath ? { sourcePath: opts.sourcePath } : {}),
  });
  return inFreshRoot((root) =>
    runScenario(app, root, scenario, { settleMs: 20, episodeLogger: opts.episodeLogger ?? null }),
  );
}

function loadScenario(path: string): Scenario {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`could not read scenario ${path}: ${messageOf(e)}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${messageOf(e)}`);
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
    console.log(`[${s.ok ? "ok" : "FAIL"}] ${head}`);
    if (s.actionError !== undefined) console.log(`    action failed: ${s.actionError}`);
    for (const e of s.errors) console.log(`    error: ${e}`);
    for (const e of s.expectedErrors) console.log(`    expected error: ${e}`);
    if (s.expectedActionError !== undefined) {
      console.log(`    expected refusal: ${s.expectedActionError}`);
    }
    for (const f of s.failures) console.log(`    assert: ${f}`);
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

type TestRunner = { name: string; kind: string; run: () => TestResult };

/** Compile a source with tests included, import it, and run every `test` definition. */
export async function runTestsSource(
  source: string,
  capabilities: string[] = [],
  opts: { sourcePath?: string } = {},
): Promise<TestResult[]> {
  await ensureDom();
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

/** A scalar leaf value as the `expected -> actual` arrow shows it (strings get quoted). */
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

/** Prints coverage per reducer / effect / tile, listing the uncovered. */
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
  filter: string | undefined;
  total: number;
  passed: number;
  failed: number;
  /** Populated only when `opts.coverage === true`. */
  coverage?: Coverage;
};

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

function printTestReport(report: TestReport): number {
  if (report.results.length === 0) {
    if (report.filter) {
      console.error(`no tests match "${report.filter}"`);
      return 1;
    }
    console.log("no tests found");
    return 0;
  }
  for (const r of report.results) {
    // `(1ms)`, or `(100 cases, 23ms)` for a property-test.
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

/** CLI entry: run `test` definitions, print the report, exit non-zero on any failure. */
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
    const runSafe = async (): Promise<void> => {
      try {
        await runOnce();
      } catch (e) {
        console.error(`test run failed: ${messageOf(e)}`);
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
