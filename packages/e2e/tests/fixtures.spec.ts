import { readFileSync } from "node:fs";
import { runOnPage, type Scenario } from "@kumikijs/e2e";
import { appsDir, browserScenarioCases, featuresDir } from "@kumikijs/examples";
import { expect, test } from "@playwright/test";

const fixtures = browserScenarioCases();

test("browser fixtures were discovered", () => {
  expect(fixtures.some((fx) => fx.kumiki.startsWith(featuresDir))).toBe(true);
  expect(fixtures.some((fx) => fx.kumiki.startsWith(appsDir))).toBe(true);
});

for (const fx of fixtures) {
  test(fx.label, async ({ page }) => {
    const source = readFileSync(fx.kumiki, "utf8");
    const scenario = JSON.parse(readFileSync(fx.scenario, "utf8")) as Scenario;
    const report = await runOnPage(page, source, scenario);
    if (!report.ok) {
      const detail = report.steps
        .map((s, i) => {
          const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
          const lines = [head];
          if (s.actionError !== undefined) lines.push(`    action failed: ${s.actionError}`);
          if (s.expectedActionError !== undefined) {
            lines.push(`    expected refusal: ${s.expectedActionError}`);
          }
          for (const e of s.errors) lines.push(`    error: ${e}`);
          for (const f of s.failures) lines.push(`    assert: ${f}`);
          return lines.join("\n");
        })
        .join("\n");
      throw new Error(`${fx.label} failed browser scenario:\n${detail}`);
    }
  });
}
