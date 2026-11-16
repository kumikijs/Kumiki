// A browser-tier step has no key action and cannot press Tab, so these drive
// the real keyboard and tab order.

import { expect, test } from "@playwright/test";
import { useFeatureLog } from "./helpers/feature-log.ts";

const log = useFeatureLog("266-outlet-and-scroll-selectors");

test("Tab passes over a scroll whose content fits, and stops on one that overflows", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  await expect(page.locator("#pane")).toBeFocused();
  expect(await log(page)).toBe("pf ");
});

test("a key on an overflowing scroll and Tab off it run its handlers", async ({ page }) => {
  await page.keyboard.press("Tab");
  await expect(page.locator("#pane")).toBeFocused();
  await page.keyboard.press("a");
  expect(await log(page)).toBe("pf pk ");
  // The Tab's own keydown reaches the scroll before focus leaves it for the input.
  await page.keyboard.press("Tab");
  await expect(page.locator("#note")).toBeFocused();
  expect(await log(page)).toBe("pf pk pk pb lf ");
});

test("Tab passes over a scroll that holds a control, onto the control", async ({ page }) => {
  await page.locator("#pane").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#note")).toBeFocused();
  await expect(page.locator("#list")).not.toBeFocused();
});

// Both run once, though each is lifted onto the scroll as well as the input: focus does not
// bubble to the scroll's <div>, and the scroll takes no key listener.
test("focus and a key in the input inside a scroll run ui.focus(List) and ui.key(List) once", async ({
  page,
}) => {
  await page.locator("#note").focus();
  expect(await log(page)).toBe("lf ");
  await page.keyboard.press("x");
  expect(await log(page)).toBe("lf t ");
  await expect(page.locator("#note")).toHaveValue("x");
});
