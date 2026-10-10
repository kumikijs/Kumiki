import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const app = (item: string): string =>
  withApp(`slot picked  : Text = "-"
slot picked2 : Text = "-"
slot names   : List(Text) = ["a", "b"]
reducer pick  on=ui.click(Item) do= picked := $el.item-name
reducer pick2 on=ui.click(Item) do= picked2 := $el.plain
tile Item in=Text = ${item}
tile App = column(text("picked: " + picked), column(for n in names Item(n)))`);

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
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});

const inputApp = withApp(`slot typed   : Text = "-"
slot changed : Text = "-"
slot names   : List(Text) = ["a", "b"]
reducer typing on=ui.input(Field)  do= typed := $el.item-name + "=" + $el.value
reducer commit on=ui.change(Field) do= changed := $el.item-name
tile Field in=Text = input(placeholder=$1) {item-name: $1, id: $1}
tile App = column(text("typed: " + typed), column(for n in names Field(n)))`);

describe("$el.<kebab-name> reaches ui.input and ui.change reducers", () => {
  it("reads the prop in both reducers when the field is filled", async () => {
    const shape = await loadSource(inputApp);
    const report = await runScenario(shape, freshRoot(), {
      steps: [
        {
          do: { fill: "#b", value: "x" },
          expect: {
            noErrors: true,
            state: { typed: "b=x", changed: "b" },
            domIncludes: ["typed: b=x"],
          },
        },
      ],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});
