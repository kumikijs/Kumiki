// A step whose action could not run must fail, and must not be mistaken for
// something the app said. The scenario tier keeps the two apart on separate
// channels (`actionError` vs `errors`) because `errorIncludes` could otherwise
// claim a broken selector; this tier refuses `errorIncludes` outright, but the
// same split matters here for a different reason: `noErrors` reads `errors`,
// and every reported error is fatal, so a scenario's own typo used to be
// reported as a defect in the app.
//
// And `fill` shares the shape the scenario tier had to fix — a selector that
// drifts from an input onto its wrapper. Playwright refuses it too, but only
// after spending the actionability timeout, and without saying what it matched.

import { runOnPage } from "@kumikijs/e2e";
import { expect, test } from "@playwright/test";

const SOURCE = `slot note : Text = ""
tile Box   = box(text("not a field")) {id: "box"}
tile Field = input(bind=note) {id: "field"}
tile App   = column(Box, Field, text("note: " + note))
app Fillable
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

test("fill names the element it found instead of writing an expando", async ({ page }) => {
  const report = await runOnPage(page, SOURCE, {
    steps: [{ do: { fill: "#box", value: "hello" } }],
  });
  expect(report.ok).toBe(false);
  expect(report.steps[0]?.actionError).toContain("#box matched <div>");
  expect(report.steps[0]?.actionError).toContain("holds no text to fill");
  // The app did nothing wrong, and said nothing.
  expect(report.steps[0]?.errors).toEqual([]);
  expect(report.steps[0]?.state.note).toBe("");
});

test("fill still drives the control that does hold text", async ({ page }) => {
  const report = await runOnPage(page, SOURCE, {
    steps: [{ do: { fill: "#field", value: "hello" }, expect: { state: { note: "hello" } } }],
  });
  expect(report.steps[0]?.actionError).toBeUndefined();
  expect(report.ok).toBe(true);
});

test("a selector matching nothing fails the step off the error channel", async ({ page }) => {
  const report = await runOnPage(page, SOURCE, {
    // Both verbs: `fill` looks the element up itself before handing it to
    // Playwright, so it needs the same "matched nothing" answer — and the same
    // 3s budget — as everything that goes straight to a locator.
    steps: [
      { do: { click: "#typo" }, expect: { noErrors: true } },
      { do: { fill: "#typo", value: "x" } },
    ],
  });
  expect(report.ok).toBe(false);
  expect(report.steps[0]?.actionError).toBeTruthy();
  // `noErrors` asserts on the app, and the app raised nothing — the step fails
  // on its own fault channel rather than on an assertion it did meet.
  expect(report.steps[0]?.errors).toEqual([]);
  expect(report.steps[0]?.failures).toEqual([]);
  expect(report.steps[1]?.actionError).toBeTruthy();
  expect(report.steps[1]?.errors).toEqual([]);
});
