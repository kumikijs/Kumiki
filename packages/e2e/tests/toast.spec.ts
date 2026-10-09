// The `toast` effect's banner, in Chromium. The runtime appends it to `<body>`,
// outside the mount root, and keeps it in view with `position: fixed`; the
// runtime's own tests fire the effect on a stub app and mount nothing, so a
// banner that moved under the root, scrolled away with the page, or never left
// would pass them. This fixture drives a real one through the scenario format,
// whose `domIncludes` / `domExcludes` read the runtime's overlays at this tier
// as at the scenario tier (testing.md §8.10).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage, type Scenario } from "@kumikijs/e2e";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "fixtures", "toast");
const SOURCE = readFileSync(join(dir, "toast.kumiki"), "utf8");

test("a toast shows its text and kind, and goes when its kind's default says", async ({ page }) => {
  const scenario = JSON.parse(readFileSync(join(dir, "toast.browser.json"), "utf8")) as Scenario;
  const report = await runOnPage(page, SOURCE, scenario);
  // The failing steps, whole: their failures, errors and `actionError` print
  // in the diff.
  expect(report.steps.filter((s) => !s.ok)).toEqual([]);
  expect(report.ok).toBe(true);
});

test("a toast stays in the viewport on a page taller than it", async ({ page }) => {
  // The error toast, which stays: the assertion below retries, and a banner
  // that timed out meanwhile would fail it as missing rather than as misplaced.
  const report = await runOnPage(page, SOURCE, { steps: [{ do: { clickText: "Show error" } }] });
  expect(report.ok).toBe(true);
  // Otherwise the next line holds for a banner placed anywhere in the page.
  expect(await page.evaluate(() => document.body.scrollHeight > window.innerHeight)).toBe(true);
  await expect(page.locator("[data-kumiki-toast]")).toBeInViewport();
});
