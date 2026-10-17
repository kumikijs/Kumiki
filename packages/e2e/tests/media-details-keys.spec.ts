// The example's `.browser.json` has no key action, and these claims need the
// real keyboard and tab order.

import { readFileSync } from "node:fs";
import { runOnPage } from "@kumikijs/e2e";
import { feature } from "@kumikijs/examples";
import { expect, type Page, test } from "@playwright/test";

const source = readFileSync(feature("236-media-details-focus"), "utf8");

const log = (page: Page): Promise<string> =>
  page.evaluate(() =>
    String((window as unknown as { __kumikiApp: { live: { log: unknown } } }).__kumikiApp.live.log),
  );

test.beforeEach(async ({ page }) => {
  const report = await runOnPage(page, source, {
    steps: [{ label: "mounted", expect: { noErrors: true, state: { log: "" } } }],
  });
  expect(report.ok, JSON.stringify(report.steps)).toBe(true);
});

test("Tab passes over a video without controls", async ({ page }) => {
  await page.locator("#toggle").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#faq summary")).toBeFocused();
  expect(await log(page)).toBe("");
});

test("Tab onto a video with controls, a key on it and Tab off it run its reducers", async ({
  page,
}) => {
  await page.locator("#toggle").click();
  await expect(page.locator("#clip")).toHaveJSProperty("controls", true);
  await page.keyboard.press("Tab");
  await expect(page.locator("#clip")).toBeFocused();
  expect(await log(page)).toBe("cf ");
  await page.keyboard.press("Space");
  expect(await log(page)).toBe("cf ck ");
  // The Tab's own keydown reaches the video before focus leaves it.
  await page.keyboard.press("Tab");
  await expect(page.locator("#faq summary")).toBeFocused();
  expect(await log(page)).toBe("cf ck ck cb ");
});

test("a key on the summary runs only the onKeyDown written on the details", async ({ page }) => {
  await page.locator("#faq summary").focus();
  await page.keyboard.press("ArrowDown");
  expect(await log(page)).toBe("fk ");
});

test("a key in the panel's input runs ui.key(Faq) once, then the details' onKeyDown", async ({
  page,
}) => {
  await page.locator("#answer").focus();
  await page.keyboard.press("a");
  expect(await log(page)).toBe("ft fk ");
  await expect(page.locator("#answer")).toHaveValue("a");
});
