import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenarioSource } from "@kumikijs/cli";
import type { Scenario } from "@kumikijs/runtime";
import { expect, it } from "vitest";
import { failureDetail } from "./helpers/scenario.ts";

// A learning-cost task scores what an output does against hidden acceptance scenarios, and its
// reference solution shows that every one of them can be met. A change that breaks a reference's
// criterion would score every output of that task against a criterion nothing can pass.
const learningCost = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "benchmarks",
  "learning-cost",
);

const cases = readdirSync(learningCost)
  .filter((task) => existsSync(join(learningCost, task, "reference", "app.kumiki")))
  .flatMap((task) =>
    readdirSync(join(learningCost, task, "acceptance"))
      .filter((f) => f.endsWith(".scenario.json"))
      .map((f) => ({ task, criterion: f.slice(0, -".scenario.json".length) })),
  );

// A floor at the current count: an empty it.each registers nothing and passes.
it("finds the criteria", () => {
  expect(cases.length).toBeGreaterThanOrEqual(86);
});

it.each(cases)("$task reference meets $criterion", async ({ task, criterion }) => {
  // As acceptance.mjs does: every criterion starts at `/`, whatever the last one left.
  window.history.replaceState(null, "", "/");
  const source = readFileSync(join(learningCost, task, "reference", "app.kumiki"), "utf8");
  const scenario = JSON.parse(
    readFileSync(join(learningCost, task, "acceptance", `${criterion}.scenario.json`), "utf8"),
  ) as Scenario;
  const report = await runScenarioSource(source, scenario);
  expect(report.ok, failureDetail(report)).toBe(true);
});
