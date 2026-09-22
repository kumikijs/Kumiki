// The platform facts `control-check.ts` rests on, measured rather than reasoned
// (#369) — and then the rule itself, running at this tier.
//
// The first half is the measurement kept as a test. Which verbs a `disabled` or
// `readonly` control refuses is the whole content of `CONTROL_DEMANDS`, and
// every entry in that table is a claim about a browser: a wrong one either lets
// a scenario assert behaviour the product cannot produce (the bug) or refuses a
// step a browser would have run (the opposite bug, which is worse, because it
// reports a working program broken). Reading the HTML spec would not have
// settled `hover` — Chromium fires `mouseenter` on a disabled control, which is
// why `hover` is absent from the table.
//
// It runs against `page.setContent`, not a Kumiki app, on purpose: what is
// being pinned is the platform, and putting a renderer in between would let a
// renderer change explain away a failure here.

import { runOnPage } from "@kumikijs/e2e";
import { expect, test } from "@playwright/test";

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<input id="d-input" disabled>
<input id="r-input" readonly>
<button id="d-btn" disabled>go</button>
<label id="d-check"><input type="checkbox" disabled></label>
<div id="ed-off" contenteditable="false">old</div>
<script>
  window.seen = [];
  for (const id of ['d-input','r-input','d-btn','d-check','ed-off']) {
    for (const t of ['click','focus','keydown','mouseenter'])
      document.getElementById(id).addEventListener(t, () => window.seen.push(id + ':' + t), true);
  }
</script>
</body>`;

const seen = (page: import("@playwright/test").Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { seen: string[] }).seen);

// Short on purpose: each of these is a refusal, so the wait is the assertion
// and the suite should not pay the 3s the runner budgets for a real one.
const REFUSED = { timeout: 1000 };

test.describe("what a browser refuses", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(PAGE);
  });

  test("a disabled control takes no click, through a <label> wrapper too", async ({ page }) => {
    await expect(page.locator("#d-btn").click(REFUSED)).rejects.toThrow(/Timeout/);
    // The state is on the <input>; the id is on the <label>, which is exactly
    // what `check` / `radio` / `switch` render — so `readControl` has to look
    // through the wrapper to agree with this.
    await expect(page.locator("#d-check").click(REFUSED)).rejects.toThrow(/Timeout/);
    expect(await seen(page)).toEqual([]);
  });

  test("a disabled control takes no typing, and neither does a readonly one", async ({ page }) => {
    await expect(page.locator("#d-input").fill("typed", REFUSED)).rejects.toThrow(/Timeout/);
    await expect(page.locator("#r-input").fill("typed", REFUSED)).rejects.toThrow(/Timeout/);
    expect(await page.locator("#d-input").inputValue()).toBe("");
    expect(await page.locator("#r-input").inputValue()).toBe("");
  });

  // Why the rule exists at this tier at all: Playwright's actionability refuses
  // most of these, but `focus()` is not one of them. It resolves, moves no
  // focus, and reports nothing — the same silent pass the scenario tier had.
  test("focus() on a disabled control passes silently, having done nothing", async ({ page }) => {
    await page.locator("#d-input").focus();
    expect(await seen(page)).toEqual([]);
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("d-input");
  });

  test("readonly refuses the typing alone: focus and keydown still arrive", async ({ page }) => {
    await page.locator("#r-input").focus();
    await page.keyboard.press("a");
    expect(await seen(page)).toEqual(["r-input:focus", "r-input:keydown"]);
  });

  // The two entries a reader would expect to travel with `fill` and do not.
  test("contenteditable=false takes no typing, and takes a click", async ({ page }) => {
    await expect(page.locator("#ed-off").fill("typed", REFUSED)).rejects.toThrow(
      /not an <input>, <textarea>, <select> or \[contenteditable\]/,
    );
    await page.locator("#ed-off").click();
    expect(await seen(page)).toContain("ed-off:click");
    expect(await page.locator("#ed-off").textContent()).toBe("old");
  });

  test("mouseenter reaches a disabled control, so `hover` is not a control verb", async ({
    page,
  }) => {
    await page.locator("#d-input").hover();
    await page.locator("#d-btn").hover();
    expect(await seen(page)).toEqual(["d-input:mouseenter", "d-btn:mouseenter"]);
  });
});

const SOURCE = `slot locked : Text = "sealed"
slot sealed : Text = "kept"
slot live   : Text = ""
slot clicks : Int  = 0

reducer clicked on=ui.click(Off) do= clicks := clicks + 1

tile Locked = input(bind=locked) {id: "locked", disabled: true}
tile Sealed = input(bind=sealed) {id: "sealed", readonly: true}
tile Off    = button(text="off") {id: "off", disabled: true}
tile Live   = input(bind=live) {id: "live"}
tile App    = column(Locked, Sealed, Off, Live, text("clicks: " + clicks.show))
app DisabledControls
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

test.describe("the rule, at this tier", () => {
  test("refuses in the same words the scenario tier uses", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [
        { do: { fill: "#locked", value: "typed" } },
        { do: { fill: "#sealed", value: "typed" } },
        { do: { click: "#off" } },
        { do: { focus: "#locked" } },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain("<input> is disabled, so it takes no typing");
    expect(report.steps[1]?.actionError).toContain("<input> is readonly, so it takes no typing");
    expect(report.steps[2]?.actionError).toContain(
      "<button> is disabled, so no user gesture reaches it",
    );
    expect(report.steps[3]?.actionError).toContain("<input> is disabled");
    // The app did nothing wrong and said nothing: a refusal is not a defect.
    for (const step of report.steps) expect(step.errors).toEqual([]);
    expect(report.steps[0]?.state.locked).toBe("sealed");
  });

  // The key the fixture in `packages/examples` uses, so a scenario asserting a
  // refusal is runnable at both tiers rather than only the one it was written
  // against.
  test("actionErrorIncludes turns a refusal into a passing assertion", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [
        {
          do: { click: "#off" },
          expect: { actionErrorIncludes: ["<button> is disabled"], state: { clicks: 0 } },
        },
        { do: { fill: "#live", value: "hello" }, expect: { state: { live: "hello" } } },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.steps[0]?.expectedActionError).toContain("is disabled");
  });

  test("a step that asks to be refused and is not still fails", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [{ do: { fill: "#live", value: "x" }, expect: { actionErrorIncludes: ["disabled"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.failures[0]).toContain("but it ran");
  });
});
