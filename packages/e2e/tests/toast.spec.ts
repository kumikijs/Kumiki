// The runtime's own tests fire the effect on a stub app and mount nothing, so a
// banner that moved under the root, scrolled away with the page, or never left
// would pass them.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage, type Scenario } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

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

/** Where the banner of `level` is drawn, in viewport pixels. */
async function box(page: Page, level: string) {
  const found = await page.locator(`[data-kumiki-toast][data-level='${level}']`).boundingBox();
  if (!found) throw new Error(`no ${level} toast is drawn`);
  return found;
}

// A headless DOM computes no layout, so only here does "stacked" mean apart on screen.
test("toasts shown together stack at the bottom-right, and close the gap one leaves", async ({
  page,
}) => {
  const report = await runOnPage(page, SOURCE, {
    steps: [{ do: { clickText: "Show error" } }, { do: { clickText: "Show info" } }],
  });
  expect(report.ok).toBe(true);
  // The area `position: fixed` places against: the viewport less any scrollbar.
  const view = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  const error = await box(page, "error");
  const info = await box(page, "info");
  // Apart, the newer one nearer the corner, and both against the right edge.
  expect(error.y + error.height).toBeLessThanOrEqual(info.y);
  expect(Math.abs(info.y + info.height - (view.height - 24))).toBeLessThanOrEqual(1);
  for (const b of [error, info]) {
    expect(Math.abs(b.x + b.width - (view.width - 24))).toBeLessThanOrEqual(1);
  }

  await page.locator("[data-kumiki-toast][data-level='info'] [data-kumiki-toast-dismiss]").click();
  await expect(page.locator("[data-kumiki-toast]")).toHaveCount(1);
  const moved = await box(page, "error");
  expect(Math.abs(moved.y + moved.height - (info.y + info.height))).toBeLessThanOrEqual(1);
});

for (const key of ["Escape", "Enter"]) {
  test(`a keyboard user reaches a toast's dismiss button with Tab and dismisses it with ${key}`, async ({
    page,
  }) => {
    const report = await runOnPage(page, SOURCE, { steps: [{ do: { clickText: "Show error" } }] });
    expect(report.ok).toBe(true);
    // The click left focus on "Show error", and the stack follows the app in the tab order.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeFocused();
    await page.keyboard.press(key);
    await expect(page.locator("[data-kumiki-toast]")).toHaveCount(0);
  });
}
