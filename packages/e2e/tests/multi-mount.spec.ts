// Multi-mount browser tier: two compiled apps co-mounted on ONE page must not
// cross-wire (issue: the runtime used a shared `__kumikiApp` global, so the
// last mount captured the other app's events). The fixture drives real clicks
// and fills scoped per root and asserts each app's state independently.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMultiOnPage, type ScenarioStep } from "@kumikijs/e2e";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const multiDir = join(here, "fixtures", "multi");

type MultiFixture = { apps: string[]; steps: ScenarioStep[] };

test("two apps co-mounted on one page stay isolated", async ({ page }) => {
  const fx = JSON.parse(
    readFileSync(join(multiDir, "two-apps.browser.json"), "utf8"),
  ) as MultiFixture;
  expect(fx.apps.length).toBeGreaterThan(1);
  const sources = fx.apps.map((f) => readFileSync(join(multiDir, f), "utf8"));

  const report = await runMultiOnPage(page, sources, { steps: fx.steps });
  if (!report.ok) {
    const detail = report.steps
      .map((s, i) => {
        const head = `step ${i}${s.label ? ` (${s.label})` : ""}${s.action ? `: ${s.action}` : ""}`;
        const lines = [head];
        for (const e of s.errors) lines.push(`    error: ${e}`);
        for (const f of s.failures) lines.push(`    assert: ${f}`);
        return lines.join("\n");
      })
      .join("\n");
    throw new Error(`two-apps failed browser scenario:\n${detail}`);
  }
});
