// language.md §1.6.5 defines `$el` as the `{...}` props of the tile that fired
// the event, and §1.7.3 delivers `{todoId: $1}` as `$el.todoId`. Nothing keeps
// a prop name from being kebab-case, which is the house style for Kumiki names.
//
// The payload keyed each prop the way names the runtime defines are keyed,
// with `-` rewritten to `_`, while the reducer's `$el.item-name` read the
// source spelling. The two never met: the reducer read `undefined`, and the
// slot it wrote dropped out of the state. A prop reaches the payload both from
// the props block and as a named argument, so both are asserted.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

const app = (item: string): string => `slot picked  : Text = "-"
slot picked2 : Text = "-"
slot names   : List(Text) = ["a", "b"]
reducer pick  on=ui.click(Item) do= picked := $el.item-name
reducer pick2 on=ui.click(Item) do= picked2 := $el.plain
tile Item in=Text = ${item}
tile App = column(text("picked: " + picked), column(for n in names Item(n)))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("$el.<kebab-name> reads the prop the tile declared", () => {
  it.each([
    ["the props block", "button(text=$1) {item-name: $1, plain: $1, id: $1}"],
    ["a named argument", "button(text=$1, item-name=$1, plain=$1) {id: $1}"],
  ])("written in %s", async (_label, item) => {
    const shape = await loadSource(app(item));
    const report = await runScenario(shape, freshRoot(), {
      steps: [
        {
          do: { click: "#b" },
          expect: {
            noErrors: true,
            state: { picked: "b", picked2: "b" },
            domIncludes: ["picked: b"],
          },
        },
      ],
    });
    expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  });
});
