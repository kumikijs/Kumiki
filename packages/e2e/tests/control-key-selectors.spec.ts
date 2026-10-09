import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "examples", "features", "109-control-key-focus-blur-selectors.kumiki"),
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

test("Enter on a link runs its ui.key reducer, then the link still navigates", async ({ page }) => {
  await page.locator("#home").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("the other page")).toBeVisible();
  expect(await log(page)).toMatch(/^lf lk /);
});

test("a key pressed in a check's checkbox bubbles to the label's ui.key", async ({ page }) => {
  await page.locator("#done input").focus();
  await page.keyboard.press("Space");
  expect(await log(page)).toBe("ck ");
  // Space still toggles the box, as it would with no listener on the label.
  await expect(page.locator("#done input")).toBeChecked();
});

test("an arrow key on a slider runs its ui.key reducer and still moves it", async ({ page }) => {
  await page.locator("#vol").focus();
  await page.keyboard.press("ArrowRight");
  expect(await log(page)).toBe("sf sk ");
  await expect(page.locator("#vol")).toHaveValue("55");
});

test("a key on a select runs its ui.key reducer", async ({ page }) => {
  await page.locator("#pick").focus();
  await page.keyboard.press("ArrowDown");
  expect(await log(page)).toBe("pk ");
});
