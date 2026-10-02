// A real click on a submit button that has a click reducer submits its form
// (forms.md §5.2.2): a click reducer must not cancel the click, because
// cancelling a submit button's click cancels its activation. This is the tier
// where a cancelled activation is a real one.
//
// The program is example 136, the same one its `.scenario.json` drives.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "examples", "features", "136-submit-button-click.kumiki"),
  "utf8",
);

const counts = (page: Page): Promise<{ clicks: unknown; submits: unknown }> =>
  page.evaluate(() => {
    const live = (window as unknown as { __kumikiApp: { live: Record<string, unknown> } })
      .__kumikiApp.live;
    return { clicks: live.clicks, submits: live.submits };
  });

test.beforeEach(async ({ page }) => {
  const report = await runOnPage(page, source, {
    steps: [{ label: "mounted", expect: { noErrors: true, state: { clicks: 0, submits: 0 } } }],
  });
  expect(report.ok, JSON.stringify(report.steps)).toBe(true);
});

test("clicking a submit button runs its click reducer and submits the form", async ({ page }) => {
  await page.getByRole("button", { name: "Log in" }).click();
  expect(await counts(page)).toEqual({ clicks: 1, submits: 1 });
});

test("a click reducer lifted across a tile boundary and an onClick= argument do not stop the submit", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Wrapped" }).click();
  await page.getByRole("button", { name: "By arg" }).click();
  expect(await counts(page)).toEqual({ clicks: 110, submits: 110 });
});

test("a type=button button runs its reducer and does not submit", async ({ page }) => {
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await counts(page)).toEqual({ clicks: 1000, submits: 0 });
});

test("a button with no type is a submit button: its click reducer runs and it submits", async ({
  page,
}) => {
  await page.getByRole("button", { name: "No type" }).click();
  expect(await counts(page)).toEqual({ clicks: 10000, submits: 10000 });
});

test("Enter in the form's input submits it through the submit button", async ({ page }) => {
  await page.locator("#em").fill("ada@example.com");
  await page.locator("#em").press("Enter");
  // Implicit submission fires a synthetic click on the default button, which
  // is the submit button itself, so its click reducer runs too.
  expect(await counts(page)).toEqual({ clicks: 1, submits: 1 });
});
