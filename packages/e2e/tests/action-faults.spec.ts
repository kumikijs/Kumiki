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
    steps: [
      { do: { click: "#typo" }, expect: { noErrors: true } },
      { do: { fill: "#typo", value: "x" } },
    ],
  });
  expect(report.ok).toBe(false);
  expect(report.steps[0]?.actionError).toBeTruthy();
  expect(report.steps[0]?.errors).toEqual([]);
  expect(report.steps[0]?.failures).toEqual([]);
  expect(report.steps[1]?.actionError).toBeTruthy();
  expect(report.steps[1]?.errors).toEqual([]);
});

const DISPATCH_SOURCE = `slot log : Text = ""
reducer addTodoItem on=ui.click(AddBtn)       do= log := log + "add;"
reducer scopedMiss  on=ui.click(AddBtn#other) do= log := log + "miss;"
tile AddBtn = button(text="add") {id: "add"}
tile App    = column(AddBtn, text("log: " + log))
app Dispatches
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

test("a dispatch naming no reducer fails the step, with the near-miss", async ({ page }) => {
  const report = await runOnPage(page, DISPATCH_SOURCE, {
    steps: [{ do: { dispatch: "addTodoIten" }, expect: { state: { log: "" } } }],
  });
  expect(report.ok).toBe(false);
  const fault = report.steps[0]?.actionError ?? "";
  expect(fault).toContain('no reducer named "addTodoIten"');
  expect(fault).toContain('did you mean "addTodoItem"');
  expect(report.steps[0]?.errors).toEqual([]);
});

test("a dispatch the id scope would drop fails rather than passing", async ({ page }) => {
  const report = await runOnPage(page, DISPATCH_SOURCE, {
    steps: [{ do: { dispatch: "scopedMiss" }, expect: { state: { log: "" } } }],
  });
  expect(report.ok).toBe(false);
  expect(report.steps[0]?.actionError).toContain("is scoped to #other");
});

test("a dispatch that can run still runs", async ({ page }) => {
  const report = await runOnPage(page, DISPATCH_SOURCE, {
    steps: [
      { do: { dispatch: "addTodoItem" }, expect: { state: { log: "add;" } } },
      {
        do: { dispatch: "scopedMiss", payload: { id: "other" } },
        expect: { state: { log: "add;miss;" } },
      },
    ],
  });
  expect(report.steps.flatMap((s) => [...s.errors, ...s.failures])).toEqual([]);
  expect(report.ok).toBe(true);
});
