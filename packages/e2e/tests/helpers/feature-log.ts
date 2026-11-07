import { readFileSync } from "node:fs";
import { runOnPage } from "@kumikijs/e2e";
import { feature } from "@kumikijs/examples";
import { expect, type Page, test } from "@playwright/test";

/**
 * Mounts the example feature `name` before each test of the calling file, with its `log` slot
 * empty, and returns a reader for that slot.
 */
export function useFeatureLog(name: string): (page: Page) => Promise<string> {
  const source = readFileSync(feature(name), "utf8");
  test.beforeEach(async ({ page }) => {
    const report = await runOnPage(page, source, {
      steps: [{ label: "mounted", expect: { noErrors: true, state: { log: "" } } }],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
  });
  return (page) =>
    page.evaluate(() =>
      String(
        (window as unknown as { __kumikiApp: { live: { log: unknown } } }).__kumikiApp.live.log,
      ),
    );
}
