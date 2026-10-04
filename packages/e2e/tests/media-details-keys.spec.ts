// Real key presses for a `video` and a `details` under the `ui.key` /
// `ui.focus` / `ui.blur` rows of the lift table (errors.md §W0212).
//
// The `.browser.json` of the same example drives focus and blur, and has no
// key action. Three claims need the keyboard:
//
// - a `<video>` with `controls` is in the tab order, so Tab onto it runs its
//   `ui.focus` reducer, a key on it `ui.key`, and Tab off it `ui.blur`;
// - one without `controls` is not, so Tab passes it by;
// - a `details` takes no `key` listener, so a key in its panel reaches the
//   reducer `ui.key(Faq)` lifted onto the input there exactly once, and a key
//   on its `<summary>` reaches only the `onKeyDown` written on the details.
//
// The program is example 236, the one its `.scenario.json` and
// `.browser.json` drive.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "examples", "features", "236-media-details-focus.kumiki"),
  "utf8",
);

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
