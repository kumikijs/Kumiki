import { feature } from "@kumikijs/examples";
import { type AppShape, runScenario, smoke } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { button, freshRoot, mountApp, withRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const example = feature("136-submit-button-click");

/** Click as a user does, and report whether the click was cancelled. */
function userClick(root: HTMLElement, text: string): boolean {
  let prevented = false;
  const b = button(root, text);
  const probe = (e: Event): void => {
    prevented = e.defaultPrevented;
  };
  // On the document, so it reads the flag after the button's own listener ran.
  document.addEventListener("click", probe);
  b.click();
  document.removeEventListener("click", probe);
  return prevented;
}

async function mounted(): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadApp(example);
  return { app, root: mountApp(app).root };
}

describe("a submit button with a click reducer", () => {
  it("runs the reducer, submits its form, and leaves the click uncancelled", async () => {
    const { app, root } = await mounted();
    expect(userClick(root, "Log in")).toBe(false);
    expect(app.live).toMatchObject({ clicks: 1, submits: 1 });
  });

  it("submits with a click reducer lifted across a tile boundary, and with onClick=", async () => {
    const { app, root } = await mounted();
    // `ui.click(Outer)` with `tile Outer = box(InnerBtn)`: lifted onto the button.
    userClick(root, "Wrapped");
    expect(app.live).toMatchObject({ clicks: 10, submits: 10 });
    userClick(root, "By arg");
    expect(app.live).toMatchObject({ clicks: 110, submits: 110 });
  });

  it("submits from a button with no type, which is a submit button by default", async () => {
    const { app, root } = await mounted();
    expect(userClick(root, "No type")).toBe(false);
    expect(app.live).toMatchObject({ clicks: 10000, submits: 10000 });
  });

  it("does not submit from a type=button button with a click reducer", async () => {
    const { app, root } = await mounted();
    userClick(root, "Cancel");
    expect(app.live).toMatchObject({ clicks: 1000, submits: 0 });
  });
});

describe("the scenario tier's clicks", () => {
  it("are cancelable, as a user's click is", async () => {
    const app = await loadApp(example);
    const root = freshRoot();
    const seen: boolean[] = [];
    const probe = (e: Event): void => {
      seen.push(e.cancelable);
    };
    root.addEventListener("click", probe);
    await runScenario(app, root, {
      steps: [{ do: { clickText: "Cancel" } }, { do: { click: "button" } }],
    });
    root.removeEventListener("click", probe);
    expect(seen).toEqual([true, true]);
  });
});

describe("the smoke tier's clicks", () => {
  // Both of `fire()`'s click paths: a checkbox, and every other clickable.
  const PROBE = withApp(`slot agreed : Bool = false
slot taps   : Int  = 0
reducer tap on=ui.click(GoBtn) do= taps := taps + 1
tile GoBtn = button(text="Go", type="button")
tile App = column(check(bind=agreed), GoBtn)`);

  it("are cancelable, as a user's click is, on a checkbox and on a button", async () => {
    const app = await loadSource(PROBE);
    const seen: [string, boolean][] = [];
    const probe = (e: Event): void => {
      seen.push([(e.target as HTMLElement).tagName.toLowerCase(), e.cancelable]);
    };
    const r = await withRoot(async (root) => {
      root.addEventListener("click", probe);
      return smoke(app, root, { settleMs: 20 });
    });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([
      ["input", true],
      ["button", true],
    ]);
  });
});
