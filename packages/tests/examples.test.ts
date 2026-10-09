import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { A11Y_CODES, compile, type KumikiError } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader, resolveCapabilities } from "@kumikijs/compiler/node";
import { runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "examples");

function listFeatureExamples(): string[] {
  const dir = join(examplesDir, "features");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".kumiki"))
    .map((f) => join(dir, f));
}

function listAppExamples(): string[] {
  const dir = join(examplesDir, "apps");
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory())
    .map((p) => join(p, "app.kumiki"))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

function fmtErrors(errors: KumikiError[]): string {
  return errors
    .map((e) => `${e.code} ${e.kind} @ ${e.pos.line}:${e.pos.col}: ${e.message}`)
    .join("\n");
}

function expectCompiles(file: string): void {
  const source = readFileSync(file, "utf8");
  const result = compile(source, {
    runtimeSpecifier: "./runtime.js",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities: resolveCapabilities(file),
  });
  if (result.kind === "fail") {
    throw new Error(`${file} failed to compile:\n${fmtErrors(result.errors)}`);
  }
  expect(result.js.length).toBeGreaterThan(0);
}

function expectPassesStrictA11y(file: string): void {
  const result = compile(readFileSync(file, "utf8"), {
    runtimeSpecifier: "./runtime.js",
    capabilities: resolveCapabilities(file),
    strictA11y: true,
  });
  const a11y = result.kind === "fail" ? result.errors.filter((e) => A11Y_CODES.has(e.code)) : [];
  expect(fmtErrors(a11y)).toBe("");
}

describe("feature examples", () => {
  const files = listFeatureExamples();
  it("there are feature examples to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`compiles ${file.split(/[\\/]/).slice(-1)[0]}`, () => {
      expectCompiles(file);
      expectPassesStrictA11y(file);
    });
  }
});

describe("app examples", () => {
  const files = listAppExamples();
  it("there are app examples to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    const label = file.split(/[\\/]/).slice(-2).join("/");
    it(`compiles ${label}`, () => {
      expectCompiles(file);
      expectPassesStrictA11y(file);
    });
  }
});

type ScenarioCase = { kumiki: string; scenario: string; label: string };

function listFeatureScenarios(): ScenarioCase[] {
  const dir = join(examplesDir, "features");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".scenario.json"))
    .map((f) => {
      const base = f.replace(/\.scenario\.json$/, "");
      return {
        kumiki: join(dir, `${base}.kumiki`),
        scenario: join(dir, f),
        label: base,
      };
    })
    .filter((s) => statSync(s.kumiki).isFile());
}

/** Every `apps/<name>/scenario.json`, paired with the app it drives. */
function listAppScenarios(): ScenarioCase[] {
  return listAppExamples()
    .map((kumiki) => ({
      kumiki,
      scenario: join(dirname(kumiki), "scenario.json"),
      label: kumiki.split(/[\\/]/).slice(-2)[0] ?? kumiki,
    }))
    .filter((s) => {
      try {
        return statSync(s.scenario).isFile();
      } catch {
        return false;
      }
    });
}

/** Where `kumiki run` starts, and where every scenario case is put back. */
const SCENARIO_ORIGIN_ROOT = "http://localhost/";

async function runScenarioCase(s: ScenarioCase): Promise<void> {
  if (location.href !== SCENARIO_ORIGIN_ROOT) location.href = SCENARIO_ORIGIN_ROOT;
  window.history.replaceState(null, "", "/");
  const app = await loadApp(s.kumiki);
  const root = document.createElement("div");
  document.body.appendChild(root);
  try {
    const scenario = JSON.parse(readFileSync(s.scenario, "utf8")) as Scenario;
    const report = await runScenario(app, root, scenario);
    if (report.ok) return;
    const detail = report.steps
      .map((st, i) => ({ st, i }))
      .filter(({ st }) => !st.ok)
      .map(({ st, i }) => {
        const fault = st.actionError ? ` action-failed=${st.actionError}` : "";
        const errs = st.errors.length ? ` errors=${st.errors.join("|")}` : "";
        const fails = st.failures.length ? ` failures=${st.failures.join("|")}` : "";
        return `step ${i} (${st.label ?? st.action ?? "-"}):${fault}${errs}${fails}`;
      })
      .join("\n");
    throw new Error(`${s.label} did not pass its scenario:\n${detail}`);
  } finally {
    root.remove();
  }
}

describe("feature scenarios", () => {
  const scenarios = listFeatureScenarios();
  it("there are feature scenarios to run", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });
  for (const s of scenarios) {
    it(`runs ${s.label}.scenario.json`, () => runScenarioCase(s));
  }
});

describe("app scenarios", () => {
  const scenarios = listAppScenarios();

  it("every app example ships a scenario", () => {
    const scenarioed = new Set(scenarios.map((s) => s.kumiki));
    const missing = listAppExamples()
      .filter((f) => !scenarioed.has(f))
      .map((f) => f.split(/[\\/]/).slice(-2)[0]);
    expect(missing).toEqual([]);
  });

  for (const s of scenarios) {
    it(`runs ${s.label}/scenario.json`, () => runScenarioCase(s));
  }
});
