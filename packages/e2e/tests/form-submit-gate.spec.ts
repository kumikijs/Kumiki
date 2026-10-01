// Implicit submission for the form submit gate (forms.md §5.2.2). Enter in a
// text field makes the browser submit the form through its submit button — a
// path this tier's `.browser.json` has no action for, and one happy-dom does
// not implement. The gate has to hold it back like any other submit, and let
// it through once the field shows a value its slot accepts.
//
// The program is example 135, the same one its `.scenario.json` and
// `.browser.json` drive.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOnPage } from "@kumikijs/e2e";
import { expect, type Page, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "examples", "features", "135-form-submit-gate.kumiki"),
  "utf8",
);

const sent = (page: Page): Promise<string> =>
  page.evaluate(() =>
    String(
      (window as unknown as { __kumikiApp: { live: { sent: unknown } } }).__kumikiApp.live.sent,
    ),
  );

test("Enter in a field showing a refused value does not submit, and does once it is fixed", async ({
  page,
}) => {
  const report = await runOnPage(page, source, {
    steps: [
      {
        label: "a refused edit leaves the slot on its last accepted address",
        do: { fill: "#email", value: "ada@example.com" },
        expect: { noErrors: true, state: { email: "ada@example.com" } },
      },
      {
        label: "then an edit the refinement refuses",
        do: { fill: "#email", value: "ada@examplecom" },
        expect: { noErrors: true, state: { email: "ada@example.com" } },
      },
    ],
  });
  expect(report.ok, JSON.stringify(report.steps)).toBe(true);

  await page.locator("#email").press("Enter");
  expect(await sent(page)).toBe("(nothing)");

  await page.locator("#email").fill("grace@example.com");
  await page.locator("#email").press("Enter");
  await expect.poll(() => sent(page)).toBe(" <grace@example.com>");
});
