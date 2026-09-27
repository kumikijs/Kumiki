// A tile is a pure function of the slots and its `in` argument (language.md
// §1.7.2 Invariant 1), and a binding ends with the scope that declared it
// (§1.6.7). A user tile's body is not lexically inside its caller's `for`,
// `match` or `let`, so a name the body reads as a slot is the slot wherever
// the tile is called from — even where the caller has bound the same name.
// The caller's bindings do reach the call's own argument: `FilterBtn(filter)`
// passes the loop variable as `$1`.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

const app = (defs: string): string => `${defs}
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** Mount the app and assert what its first render shows and does not show. */
async function renders(src: string, domIncludes: string[], domExcludes: string[]): Promise<void> {
  const shape = await loadSource(app(src));
  const report = await runScenario(shape, freshRoot(), {
    steps: [{ expect: { noErrors: true, domIncludes, domExcludes } }],
  });
  expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
}

const SHOW = `slot label : Text       = "from-slot"
slot names : List(Text) = ["a", "b"]
tile Show = text("show: " + label + ";")`;

describe("a user tile's body does not see its caller's bindings", () => {
  it("in a for loop, where the tile's argument is the loop variable", async () => {
    // The loop variable reaches `$1` — every filter is rendered — and the
    // body's `filter` is the slot, so only `All` is marked.
    await renders(
      `type Filter = All | Active | Done
slot filter  : Filter       = All
slot filters : List(Filter) = [All, Active, Done]
tile FilterBtn in=Filter = button(text=$1.show + (if $1 == filter then " (current)" else ""))
tile App = row(for filter in filters FilterBtn(filter))`,
      ["All (current)", "Active", "Done"],
      ["Active (current)", "Done (current)"],
    );
  });

  it.each([
    ["a for loop", "column(for label in names Show)", ["show: a;", "show: b;"]],
    [
      "a match arm",
      'column(match Some("from-match") with | Some(label) -> Show | None -> text("none"))',
      ["show: from-match;"],
    ],
  ])("in %s, for a tile with no argument", async (_label, app, leaked) => {
    await renders(`${SHOW}\ntile App = ${app}`, ["show: from-slot;"], leaked);
  });

  it("through a nested user-tile call", async () => {
    await renders(
      `${SHOW}
tile Outer in=Text = column(text("outer: " + $1 + ";"), Show)
tile App = column(for label in names Outer(label))`,
      ["outer: a;", "outer: b;", "show: from-slot;"],
      ["show: a;", "show: b;"],
    );
  });
});
