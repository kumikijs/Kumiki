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

const REFUSED = { timeout: 1000 };

test.describe("what a browser refuses", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(PAGE);
  });

  test("a disabled control takes no click, through a <label> wrapper too", async ({ page }) => {
    await expect(page.locator("#d-btn").click(REFUSED)).rejects.toThrow(/Timeout/);
    await expect(page.locator("#d-check").click(REFUSED)).rejects.toThrow(/Timeout/);
    expect(await seen(page)).toEqual([]);
  });

  test("and Chromium drops a real click even when actionability is skipped", async ({ page }) => {
    await page
      .locator("#d-btn")
      .click({ force: true, timeout: 2000 })
      .catch(() => {});
    expect(await seen(page)).toEqual(["d-btn:mouseenter"]);
  });

  test("but a synthetic dispatch reaches a disabled control, which is the bug", async ({
    page,
  }) => {
    await page.evaluate(() => {
      document.getElementById("d-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(await seen(page)).toEqual(["d-btn:click"]);
  });

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

  test("and drives the select that is not disabled", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [{ do: { choose: "#open", value: "Bee" }, expect: { state: { open_pick: "b" } } }],
    });
    expect(report.steps[0]?.actionError).toBeUndefined();
    expect(report.ok).toBe(true);
  });

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

  test("a fault that is not a refusal cannot be claimed as one", async ({ page }) => {
    const report = await runOnPage(page, SOURCE, {
      steps: [{ do: { click: "#off-disabled" }, expect: { actionErrorIncludes: ["disabled"] } }],
    });
    expect(report.ok).toBe(false);
    expect(report.steps[0]?.expectedActionError).toBeUndefined();
    expect(report.steps[0]?.failures[0]).toContain("but it failed to resolve");
  });
});
