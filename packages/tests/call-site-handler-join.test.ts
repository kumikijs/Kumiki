// A handler written on a user-tile call site joins the handlers already on the
// node that tile renders (#407), and every reducer matching the click runs
// once, in definition order (language.md §1.6.4 Invariant 3).
//
// It used to be spread over the finished node, which REPLACED the lifted
// subscriptions: `check` said ok, the enclosing tile's reducer never ran, and
// `02-todomvc`'s delete button silently dropped the row's `toggle`. The
// compiler tests pin the shape emitted; this clicks, because what the issue
// is about is which reducers run and in what order.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The issue's program, with the two reducers in the order given. */
function program(reducers: string): string {
  return [
    'slot log : Text = ""',
    reducers,
    'tile Btn = button(text="x")',
    "tile Row = row(Btn {onClick: btnOwn})",
    "tile App = column(Row, text(log))",
    'app A caps=[] routes={"/" -> App, "/404" -> App} init=[]',
    "",
  ].join("\n");
}

const ROW_FIRST = [
  'reducer rowClick on=ui.click(Row) do= log := log + "R"',
  'reducer btnOwn   on=ui.click(Btn) do= log := log + "B"',
].join("\n");

const BTN_FIRST = [
  'reducer btnOwn   on=ui.click(Btn) do= log := log + "B"',
  'reducer rowClick on=ui.click(Row) do= log := log + "R"',
].join("\n");

async function clickOnce(src: string): Promise<unknown> {
  const app = await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  const btn = root.querySelector("button");
  if (!btn) throw new Error("no button rendered");
  btn.click();
  return app.live?.log;
}

describe("a call-site handler joins the lifted one (#407)", () => {
  it("runs the enclosing tile's reducer as well as the call site's", async () => {
    expect(await clickOnce(program(ROW_FIRST))).toBe("RB");
  });

  it("runs them in definition order, not in the order they were wired", async () => {
    // The call site's reducer is the explicit one; defined first, it runs
    // first. Under an "explicit first" rule this would read the same as the
    // case above, so the two together are what pin the order.
    expect(await clickOnce(program(BTN_FIRST))).toBe("BR");
  });

  it("wires 02-todomvc's delete button to toggle and then remove", () => {
    // `toggle` is defined before `remove`, so it runs while the todo still
    // exists. The other order would have `toggle` write through the key
    // `remove` had just deleted.
    const src = readFileSync(
      join(here, "..", "examples", "apps", "02-todomvc", "app.kumiki"),
      "utf8",
    );
    const result = compile(src, { runtimeSpecifier: "@kumikijs/runtime" });
    if (result.kind !== "ok") throw new Error(result.errors.map((e) => e.code).join(", "));
    expect(result.js).toContain('onClick: _h("toggle", "remove")');
    expect(result.js).not.toContain('onClick: _h("remove")');
  });
});
