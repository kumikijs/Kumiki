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
import { runMultiOnPage, runOnPage } from "@kumikijs/e2e";
import { ConstraintRefusal, SubmitRefusal } from "@kumikijs/runtime";
import { expect, type Page, test } from "@playwright/test";
import { performAction } from "../src/browser.ts";

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

/** A program whose one form submits to `send`, rooted at `root`. */
const program = (decls: string, tiles: string, root = "Signup"): string => `${decls}

reducer send on=ui.submit(Signup) do= sends := sends + 1

${tiles}

app SubmitGate
    caps   = []
    routes = {"/" -> ${root}, "/404" -> ${root}}
    init   = []
`;

// Two fields that both fail, so the record crosses `page.evaluate` with more
// than one slot in it.
const twoFailing = program(
  `slot email : Text where email = ""
slot code  : Text where nonempty = ""
slot sends : Int = 0`,
  `tile Signup = form(column(input(bind=email, id="e"), input(bind=code, id="k")))`,
);

test("a {submit} two fields hold back names both, in the order the form binds them", async ({
  page,
}) => {
  const report = await runOnPage(page, twoFailing, {
    steps: [{ do: { submit: "#e" }, expect: { state: { sends: 0 } } }],
  });
  expect(report.ok).toBe(false);
  expect(report.steps[0]?.actionError).toContain(
    "submit #e: the form held the submit back — the fields bound to email, code fail their validation",
  );
});

// Co-mounted, each app's form is judged by its own app: the held-back one is
// refused, and the neighbour's submit goes through. The held-back form is in
// the first app, not the last, because `__kumikiApp` is the last one mounted:
// each bundle keeps its own record, so asking that app alone about the first
// app's submit would hear nothing, and pass.
const holding = program(
  `slot email : Text where email = ""
slot sends : Int = 0`,
  `tile Signup = form(column(input(bind=email, id="e")))`,
);
const passing = program(
  `slot name  : Text = ""
slot sends : Int = 0`,
  `tile Signup = form(column(input(bind=name, id="n")))`,
);

test.describe("co-mounted apps", () => {
  test("a {submit} is judged by the app that owns the form", async ({ page }) => {
    const report = await runMultiOnPage(page, [holding, passing], {
      steps: [
        {
          do: { submit: "#kumiki-root-0 #e" },
          expect: {
            actionErrorIncludes: ["the field bound to email fails its validation"],
            state: { "0.sends": 0 },
          },
        },
        { do: { submit: "#kumiki-root-1 #n" }, expect: { state: { "1.sends": 1 } } },
      ],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
    expect(report.steps[1]?.actionError).toBeUndefined();
  });

  // Every app this harness compiles carries the seam, so its absence is made
  // by hand. The neighbour still has one; asking it instead would pass.
  test("an owner without the seam fails the step, whatever its neighbour carries", async ({
    page,
  }) => {
    const report = await runMultiOnPage(page, [holding, passing], {
      steps: [{ expect: { state: { "0.sends": 0 } } }],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
    await page.evaluate(() => {
      const owner = window.__kumikiApps?.[0];
      if (owner) delete owner._submitHeldBy;
    });
    await expect(performAction(page, { submit: "#kumiki-root-0 #e" })).rejects.toThrow(
      "submit #kumiki-root-0 #e: the app that owns the form carries no `_submitHeldBy` seam",
    );
  });
});

// `requestSubmit()` runs the browser's constraint validation before it fires
// the submit event, and a control that fails it stops the submit with no event
// at all: the form tile never sees it, and its record has nothing to say. That
// used to read as a submit that went through. None of these slots has a
// refinement, so the form tile would let each submit through — and does at the
// scenario tier, which dispatches the event and skips constraint validation.
const constrained = program(
  `slot name  : Text = ""
slot mail  : Text = ""
slot age   : Int  = 0
slot sends : Int  = 0`,
  `tile Signup = form(column(
    input(bind=name, id="name", required=true),
    input(bind=mail, id="mail", type="email"),
    input(bind=age, id="age", type="number"),
    button(text="Send", type="submit")))`,
);

test.describe("a {submit} the browser's constraint validation stops is refused", () => {
  test("an empty required field", async ({ page }) => {
    const report = await runOnPage(page, constrained, {
      steps: [{ do: { submit: "#name" }, expect: { state: { sends: 0 } } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain(
      "submit #name: the browser's constraint validation stopped the submit before the form saw it" +
        " — <input type=text id=name> reports valueMissing, so no submit event fired",
    );
  });

  test("actionErrorIncludes claims it", async ({ page }) => {
    const report = await runOnPage(page, constrained, {
      steps: [
        {
          do: { submit: "#name" },
          expect: {
            actionErrorIncludes: ["<input type=text id=name> reports valueMissing"],
            state: { sends: 0 },
          },
        },
      ],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
    expect(report.steps[0]?.expectedActionError).toContain("constraint validation stopped");
  });

  test("names every control that fails, with the constraint each fails", async ({ page }) => {
    const report = await runOnPage(page, constrained, {
      steps: [
        { do: { fill: "#mail", value: "ada" } },
        { do: { submit: "#name" }, expect: { state: { sends: 0 } } },
      ],
    });
    expect(report.steps[1]?.actionError).toContain(
      "— <input type=text id=name> reports valueMissing, <input type=email id=mail> reports typeMismatch",
    );
  });

  test("passes once every control meets its constraints", async ({ page }) => {
    const report = await runOnPage(page, constrained, {
      steps: [
        { do: { fill: "#name", value: "Ada" } },
        { do: { submit: "#name" }, expect: { state: { sends: 1 } } },
      ],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
  });

  // Text that reads as no number. No step reaches it: `{fill}` refuses
  // non-numeric text for a number field, and Chromium drops typed letters such
  // as "abc" outright — but it keeps an "e", which spells no number on its own.
  test("a number field holding text that reads as no number", async ({ page }) => {
    const report = await runOnPage(page, constrained, {
      steps: [{ do: { fill: "#name", value: "Ada" } }],
    });
    expect(report.ok, JSON.stringify(report.steps)).toBe(true);
    await page.locator("#age").pressSequentially("abc");
    expect(
      await page.locator("#age").evaluate((el: HTMLInputElement) => el.validity.badInput),
    ).toBe(false);
    await page.locator("#age").pressSequentially("e");
    const refused = await performAction(page, { submit: "#age" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ConstraintRefusal);
    expect((refused as ConstraintRefusal).headline).toContain(
      "<input type=number id=age> reports badInput",
    );
    expect(await page.evaluate(() => window.__kumikiApp?.live?.sends)).toBe(0);
  });

  // The two refusals do not mix: a submit that gets past constraint
  // validation reaches the gate, which judges it as before.
  test("a submit past constraint validation is still judged by the gate", async ({ page }) => {
    await runOnPage(page, twoFailing, { steps: [{ expect: { state: { sends: 0 } } }] });
    const refused = await performAction(page, { submit: "#e" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(SubmitRefusal);
  });
});
