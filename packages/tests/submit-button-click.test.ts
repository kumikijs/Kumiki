// A click reducer on a `type="submit"` button and the form's `ui.submit` are
// independent (forms.md §5.2.2). The button renderer cancelled every click it
// had a handler for, and cancelling a submit button's click cancels its
// activation: the form never submitted in a browser. The scenario tier did not
// see it, because its clicks were not cancelable and `preventDefault` was a
// no-op there. These use `HTMLElement.click()`, which is cancelable as a
// user's click is, and pin the scenario tier's clicks to the same.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount, runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "136-submit-button-click.kumiki");

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll("button")).find((x) => x.textContent === text);
  if (!b) throw new Error(`button "${text}" not found`);
  return b;
}

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
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return { app, root };
}

describe("a submit button with a click reducer", () => {
  it("runs the reducer, submits its form, and leaves the click uncancelled", async () => {
    const { app, root } = await mounted();
    expect(userClick(root, "Log in")).toBe(false);
    expect(app.live).toMatchObject({ clicks: 1, submits: 1 });
  });

  it("submits with a click reducer lifted from a wrapping tile, and with onClick=", async () => {
    const { app, root } = await mounted();
    userClick(root, "Wrapped");
    expect(app.live).toMatchObject({ clicks: 10, submits: 10 });
    userClick(root, "By arg");
    expect(app.live).toMatchObject({ clicks: 110, submits: 110 });
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
    const root = document.createElement("div");
    document.body.appendChild(root);
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
