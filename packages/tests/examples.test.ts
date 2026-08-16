// Every example under examples/ must parse, typecheck, and build (codegen +
// runtime inlining). This is the guard behind the repo's operating model:
// questions and bug reports are answered by adding an example, and a broken
// example must never merge.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, type KumikiError } from "@kumikijs/compiler";
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

/**
 * The a11y band (`E070x`) is opt-in, so nothing in the default gate reports a
 * button with no name, an image with no `alt`, or a label whose `for` names no
 * control. The corpus is the language's own documentation — an example that
 * would fail the check an author is told to turn on is teaching the wrong
 * thing, so the corpus holds itself to it even though a user's program is not
 * required to.
 */
function expectPassesStrictA11y(file: string): void {
  const result = compile(readFileSync(file, "utf8"), {
    runtimeSpecifier: "./runtime.js",
    capabilities: resolveCapabilities(file),
    strictA11y: true,
  });
  const a11y = result.kind === "fail" ? result.errors.filter((e) => e.code.startsWith("E07")) : [];
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

// Compile is necessary but not sufficient — a feature with a co-located
// `.scenario.json` ships an executable acceptance criterion. Run it through
// the same scenario runner the CLI uses so codegen or runtime regressions that
// only surface at run time fail this suite instead of slipping past as
// compile-green. Aligned with the operating model: every new example must pass
// check + build + smoke; the scenario tier extends that to "DOM wired + reducer
// fires" for examples that opt in by providing a scenario.
function listFeatureScenarios(): { kumiki: string; scenario: string; label: string }[] {
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

describe("feature scenarios", () => {
  const scenarios = listFeatureScenarios();
  it("there are feature scenarios to run", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });
  for (const s of scenarios) {
    it(`runs ${s.label}.scenario.json`, async () => {
      const app = await loadApp(s.kumiki);
      const root = document.createElement("div");
      document.body.appendChild(root);
      try {
        const scenario = JSON.parse(readFileSync(s.scenario, "utf8")) as Scenario;
        const report = await runScenario(app, root, scenario);
        if (!report.ok) {
          const detail = report.steps
            .map((st, i) => {
              const errs = st.errors.length ? ` errors=${st.errors.join("|")}` : "";
              const fails = st.failures.length ? ` failures=${st.failures.join("|")}` : "";
              return `step ${i} (${st.label ?? st.action ?? "-"}):${errs}${fails}`;
            })
            .filter((l) => l.includes("errors=") || l.includes("failures="))
            .join("\n");
          throw new Error(`${s.label}.scenario.json did not pass:\n${detail}`);
        }
      } finally {
        root.remove();
      }
    });
  }
});
