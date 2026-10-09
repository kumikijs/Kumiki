import { readFileSync } from "node:fs";
import { appFiles, exampleLabel, type ScenarioCase, scenarioCases } from "@kumikijs/examples";
import { runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const SCENARIO_ORIGIN_ROOT = "http://localhost/";

async function expectPassesScenario(s: ScenarioCase): Promise<void> {
  if (location.href !== SCENARIO_ORIGIN_ROOT) location.href = SCENARIO_ORIGIN_ROOT;
  window.history.replaceState(null, "", "/");
  const app = await loadApp(s.kumiki);
  const scenario = JSON.parse(readFileSync(s.scenario, "utf8")) as Scenario;
  const report = await withRoot((root) => runScenario(app, root, scenario));
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
  expect(report.ok, detail).toBe(true);
}

describe.each(
  scenarioCases().map((s) => ({ ...s, name: exampleLabel(s.scenario) })),
)("$name", (s) => {
  it("passes", () => expectPassesScenario(s));
});

it("every app example ships a scenario", () => {
  const scenarioed = new Set(scenarioCases().map((s) => s.kumiki));
  expect(
    appFiles()
      .filter((f) => !scenarioed.has(f))
      .map(exampleLabel),
  ).toEqual([]);
});
