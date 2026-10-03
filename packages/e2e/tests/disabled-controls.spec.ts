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
// Three kinds of case, and each says which it is, because they are not equally
// strong. Some observe Playwright's actionability gate declining to try, which
// says only that a *user* cannot reach the control. Some skip that gate with
// `force`, so the claim is about Chromium's handling of real input. And some
// dispatch at the element directly — the weakest gate of the three, and the
// one the scenario runner actually uses: a `dispatchEvent` is delivered to a
// disabled control, so the platform refuses nothing there. That last group is
// why `control-check.ts` exists rather than being redundant with the browser.
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
<button id="d-wrap" disabled><span id="icon">go</span></button>
<label id="d-check"><input type="checkbox" disabled></label>
<div id="ed-off" contenteditable="false">old</div>
<select id="d-sel" disabled><option value="a">Ay</option><option value="b">Bee</option></select>
<script>
  window.seen = [];
  for (const id of ['d-input','r-input','d-btn','d-wrap','icon','d-check','ed-off','d-sel']) {
    for (const t of ['click','focus','blur','keydown','mouseenter','change'])
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

  // The case above measures Playwright's gate declining to try. This one skips
  // that gate with `force`, so the click is real input delivered at the
  // element's coordinates: Chromium drops it. `mouseenter` arrives and nothing
  // else — which is the same fact the `hover` case at the bottom records, from
  // the other side.
  test("and Chromium drops a real click even when actionability is skipped", async ({ page }) => {
    await page
      .locator("#d-btn")
      .click({ force: true, timeout: 2000 })
      .catch(() => {});
    expect(await seen(page)).toEqual(["d-btn:mouseenter"]);
  });

  // Why the rule has to live in the runner rather than lean on the browser.
  // Chromium's refusal above sits in the *user input* path, and the scenario
  // runner is not on it: it calls `dispatchEvent` at the element. A dispatch is
  // delivered whatever the control's state, so a `ui.click` reducer on a
  // disabled button runs — which is #369's bug, measured. Nothing at this tier
  // or the happy-dom one will turn that away on its own.
  test("but a synthetic dispatch reaches a disabled control, which is the bug", async ({
    page,
  }) => {
    await page.evaluate(() => {
      document.getElementById("d-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(await seen(page)).toEqual(["d-btn:click"]);
  });

  // The most common real shape of this bug, and the asymmetry that decides how
  // `readControl` handles it. A real click on the <span> reaches the <span> and
  // stops: Chromium does not propagate it to the disabled <button>, so a
  // `ui.click` bound there does not run. A dispatched one does reach the
  // <button> — and dispatching is what a driver does, so the reducer runs and
  // the step passes. Hence the `closest(":disabled")` ascent.
  test("a click inside a disabled button reaches it when dispatched, not when real", async ({
    page,
  }) => {
    await page
      .locator("#icon")
      .click({ force: true, timeout: 2000 })
      .catch(() => {});
    expect(await seen(page)).not.toContain("d-wrap:click");
    await page.evaluate(() => {
      (window as unknown as { seen: string[] }).seen = [];
      document.getElementById("icon")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(await seen(page)).toEqual(["d-wrap:click", "icon:click"]);
  });

  // The one synthetic path the platform does guard, and why the <label> wrapper
  // still needs `readControl`. `HTMLElement.click()` is defined to do nothing
  // on an actually-disabled control, so the click on the <input> produces
  // nothing — the <label>'s capture listener would have recorded it otherwise.
  // A <label> is not itself disabled, so the click on it does fire, and only
  // the activation it forwards to the <input> stops. A rule that read the
  // <label> alone would see a live control and let the step through.
  test("a <label> wrapping a disabled control still takes a synthetic click", async ({ page }) => {
    await page.evaluate(() => {
      (document.querySelector("#d-check input") as HTMLElement | null)?.click();
      (document.getElementById("d-check") as HTMLElement | null)?.click();
    });
    expect(await seen(page)).toEqual(["d-check:click"]);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLInputElement>("#d-check input")?.checked,
      ),
    ).toBe(false);
  });

  test("choose is refused on a disabled <select>", async ({ page }) => {
    await expect(page.locator("#d-sel").selectOption("b", REFUSED)).rejects.toThrow(/Timeout/);
    expect(await page.locator("#d-sel").inputValue()).toBe("a");
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

  // `blur` and `key` on a disabled control are consequences of the case above
  // rather than separate measurements: a control that cannot be focused cannot
  // be blurred, and a keystroke goes to whatever *is* focused. Both are pinned
  // here so the table's `blur` and `key` rows rest on something.
  test("a disabled control is never focused, so it is never blurred or typed at", async ({
    page,
  }) => {
    await page.locator("#d-input").focus();
    await page.locator("#d-input").blur();
    await page.keyboard.press("a");
    expect(await seen(page)).toEqual([]);
    expect(await page.locator("#d-input").inputValue()).toBe("");
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

const SOURCE = `slot locked    : Text = "sealed"
slot sealed    : Text = "kept"
slot live      : Text = ""
slot picked    : Text = "a"
slot open_pick : Text = "a"
slot clicks    : Int  = 0

fn picks() -> List({label: Text, value: Text})
   = [{label: "Ay", value: "a"}, {label: "Bee", value: "b"}]

reducer clicked on=ui.click(Off) do= clicks := clicks + 1
reducer busied  on=ui.click(Busy) do= clicks := clicks + 1

tile Locked = input(bind=locked) {id: "locked", disabled: true}
tile Sealed = input(bind=sealed) {id: "sealed", readonly: true}
tile Off    = button(text="off") {id: "off", disabled: true}
tile Busy   = button(text="saving", loading=true) {id: "busy"}
tile Shut   = select(bind=picked, options=picks()) {id: "shut", disabled: true}
tile Open   = select(bind=open_pick, options=picks()) {id: "open"}
tile Live   = input(bind=live) {id: "live"}
tile App    = column(Locked, Sealed, Off, Busy, Shut, Open, Live, text("clicks: " + clicks.show))
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
        { do: { blur: "#locked" } },
        { do: { choose: "#shut", value: "Bee" } },
        { do: { click: '#busy [data-kumiki-tile="spinner"]' } },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.actionError).toContain("<input> is disabled, so it takes no typing");
    expect(report.steps[1]?.actionError).toContain("<input> is readonly, so it takes no typing");
    expect(report.steps[2]?.actionError).toContain(
      "<button> is disabled, so no user gesture reaches it",
    );
    expect(report.steps[3]?.actionError).toContain("<input> is disabled");
    expect(report.steps[4]?.actionError).toContain("<input> is disabled");
    expect(report.steps[5]?.actionError).toContain("<select> is disabled");
    expect(report.steps[6]?.actionError).toContain("the <button> it matched inside is disabled");
    // The app did nothing wrong and said nothing: a refusal is not a defect.
    for (const step of report.steps) expect(step.errors).toEqual([]);
    expect(report.steps[0]?.state.locked).toBe("sealed");
  });

  // The happy path of the `readControl` round trip over a <select>: without
  // this, `refuse(loc, "choose", …)` is never executed at this tier at all.
  test("and drives the select that is not disabled", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [{ do: { choose: "#open", value: "Bee" }, expect: { state: { open_pick: "b" } } }],
    });
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.ok).toBe(true);
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

  // `actionError` is a shared channel, and `no element matching selector
  // #off-disabled` contains `disabled`. A substring match over it would claim
  // that as a refusal and report the step green.
  test("a fault that is not a refusal cannot be claimed as one", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [{ do: { click: "#off-disabled" }, expect: { actionErrorIncludes: ["disabled"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.expectedActionError).toBeUndefined();
    expect(report.steps[0]?.failures[0]).toContain("but it failed to resolve");
  });
});
