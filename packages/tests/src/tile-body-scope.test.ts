import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

/** Mount the app and assert what its first render shows and does not show. */
async function renders(src: string, domIncludes: string[], domExcludes: string[]): Promise<void> {
  const shape = await loadSource(withApp(src));
  const report = await runScenario(shape, freshRoot(), {
    steps: [{ expect: { noErrors: true, domIncludes, domExcludes } }],
  });
  expect(report.ok, failureDetail(report)).toBe(true);
}

const SHOW = `slot label : Text       = "from-slot"
slot names : List(Text) = ["a", "b"]
tile Show = text("show: " + label + ";")`;

describe("a user tile's body does not see its caller's bindings", () => {
  it("in a for loop, where the tile's argument is the loop variable", async () => {
    // The loop variable reaches `$1` — every filter is rendered — and the body's `filter` is the slot, so only `All` is marked.
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

  it("where the callee has `in=` too, its `$1` is its own argument, not the caller's", async () => {
    // Both bodies bind `$1`; the inner call's is the literal it is given.
    await renders(
      `slot names : List(Text) = ["a", "b"]
tile Inner in=Text = text("inner: " + $1 + ";")
tile Outer in=Text = column(text("outer: " + $1 + ";"), Inner("fixed"))
tile App = column(for label in names Outer(label))`,
      ["outer: a;", "outer: b;", "inner: fixed;"],
      ["inner: a;", "inner: b;"],
    );
  });

  it("where the callee's own `for` binds the name the caller binds, the callee's wins", async () => {
    await renders(
      `slot names : List(Text) = ["a", "b"]
slot items : List(Text) = ["x", "y"]
tile Each = column(for label in items text("each: " + label + ";"))
tile App = column(for label in names Each)`,
      ["each: x;", "each: y;"],
      ["each: a;", "each: b;"],
    );
  });

  it("where the call has props, they see the caller's binding while the body reads the slot", async () => {
    // Clicking the first button reports the `id` its call site gave it.
    const shape = await loadSource(
      withApp(`slot label  : Text       = "from-slot"
slot names  : List(Text) = ["a", "b"]
slot picked : Text       = "none"
reducer pick on=ui.click(Show) do= picked := $el.id
tile Show = button(text="show: " + label + ";")
tile App = column(text("picked: " + picked + ";"), for label in names Show {id: label})`),
    );
    const report = await runScenario(shape, freshRoot(), {
      steps: [
        {
          expect: { noErrors: true, domIncludes: ["show: from-slot;"], domExcludes: ["show: a;"] },
        },
        {
          do: { clickText: "show: from-slot;" },
          expect: { noErrors: true, domIncludes: ["picked: a;"] },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});
