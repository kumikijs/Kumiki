// A browser-tier step has no key action and cannot press Tab, so these drive
// the real keyboard and tab order.

import { expect, test } from "@playwright/test";
import { useFeatureLog } from "./helpers/feature-log.ts";

const log = useFeatureLog("236-media-details-focus");

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

test("a key in the panel's input runs ui.key(Faq) once, then the details's onKeyDown", async ({
  page,
}) => {
  await page.locator("#answer").focus();
  await page.keyboard.press("a");
  expect(await log(page)).toBe("ft fk ");
  await expect(page.locator("#answer")).toHaveValue("a");
});
