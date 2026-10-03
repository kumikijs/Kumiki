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

// A `{submit}` step whose form held the submit back used to pass here as at
// the scenario tier: `requestSubmit()` returned and nothing said the reducer
// had not run. It is now refused, by the rule the scenario tier asks.
test.describe("a {submit} step the form holds back is refused", () => {
  test("fails the step, naming the field that held it back", async ({ page }) => {
    const report = await runOnPage(page, source, {
      steps: [{ do: { submit: "#email" }, expect: { state: { sent: "(nothing)" } } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain(
      "submit #email: the form held the submit back — the field bound to email fails its validation",
    );
  });

  test("actionErrorIncludes claims it", async ({ page }) => {
    const report = await runOnPage(page, source, {
      steps: [
        {
          do: { submit: "#email" },
          expect: {
            noErrors: true,
            actionErrorIncludes: ["the field bound to email fails its validation"],
            state: { sent: "(nothing)" },
          },
        },
      ],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.steps[0]?.expectedActionError).toContain("held the submit back");
  });

  test("a submit that goes through passes with no error", async ({ page }) => {
    const report = await runOnPage(page, source, {
      steps: [
        { do: { fill: "#email", value: "ada@example.com" } },
        {
          do: { submit: "#email" },
          expect: { noErrors: true, state: { sent: " <ada@example.com>" } },
        },
      ],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
    expect(report.steps[1]?.actionError).toBeUndefined();
  });
});
