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

import { type Action, runOnPage } from "@kumikijs/e2e";
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

// The other verbs that take a selector, one test each so a verb that waits out
// the test's own timeout is named rather than taking its neighbours down with
// it. Each answers a selector matching nothing as `click` and `fill` do: a
// failed step on `actionError`, naming the selector, within the same 3s budget.
const UNMATCHED: Action[] = [
  { submit: "#typo" },
  { choose: "#typo", value: "x" },
  { setProperty: "#typo", property: "value", value: "x" },
];

for (const action of UNMATCHED) {
  test(`${Object.keys(action)[0]} on a selector matching nothing fails the step`, async ({
    page,
  }) => {
    const report = await runOnPage(page, SOURCE, { steps: [{ do: action }] });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain("#typo");
    expect(report.steps[0]?.errors).toEqual([]);
  });
}

// `choose` takes an option by its label, and by its value only when no option
// carries that label. The `select` tile writes each value into its <option> as
// JSON, so `"b"` (quotes included) is the value of the option labelled Bee and
// the label of the third one: a rule that took either attribute in document
// order, or the value first, would land on Bee.
const CHOOSE_SOURCE = `slot pick : Text = "a"
fn picks() -> List({label: Text, value: Text})
   = [{label: "Ay", value: "a"}, {label: "Bee", value: "b"}, {label: "\\"b\\"", value: "c"}]
tile Pick = select(bind=pick, options=picks()) {id: "pick"}
tile App  = column(Pick, text("pick: " + pick))
app Chooses
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

test("choose takes the label first, and a value no label carries", async ({ page }) => {
  const report = await runOnPage(page, CHOOSE_SOURCE, {
    steps: [
      { do: { choose: "#pick", value: '"b"' }, expect: { state: { pick: "c" } } },
      { do: { choose: "#pick", value: '"a"' }, expect: { state: { pick: "a" } } },
    ],
  });
  expect(report.steps.map((s) => s.actionError)).toEqual([undefined, undefined]);
  expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  expect(report.ok).toBe(true);
});

test("choose on a select with no such option fails the step, naming the value", async ({
  page,
}) => {
  const report = await runOnPage(page, CHOOSE_SOURCE, {
    steps: [{ do: { choose: "#pick", value: "Zed" } }],
  });
  expect(report.ok).toBe(false);
  expect(report.steps[0]?.actionError).toContain('no option "Zed" in select #pick');
  expect(report.steps[0]?.errors).toEqual([]);
  expect(report.steps[0]?.state.pick).toBe("a");
});

// `{dispatch}` is the verb where the two tiers could most easily drift: it names
// a reducer rather than matching a selector, and the seam it goes through
// returns silently when the name matches nothing. Both tiers ask the same
// `dispatchFault`, so §8.10's "exactly as at the scenario tier" is structural.
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
  // The app did nothing wrong, and said nothing — which is what makes this
  // tier's always-fatal error list the wrong channel for it.
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
