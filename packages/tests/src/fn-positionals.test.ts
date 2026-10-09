import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const app = (fn: string, type: string, call: string): string =>
  withApp(`${fn}
slot res : ${type} = ${type === "Int" ? "0" : "[]"}
reducer go on=ui.click(Go) do= res := ${call}
tile Go = button(text="go")
tile App = column(Go)`);

describe("a fn body reads its arguments by position", () => {
  it.each([
    ["$1 + $2", "fn plus(a: Int, b: Int) -> Int = $1 + $2", "Int", "plus(2, 3)", 5],
    ["$3", "fn third(a: Int, b: Int, c: Int) -> Int = $3", "Int", "third(1, 2, 7)", 7],
    [
      "a mix of names and positions",
      "fn minus(a: Int, b: Int) -> Int = a - $2",
      "Int",
      "minus(9, 4)",
      5,
    ],
    // Outside the fragment `$1` is the fn's `xs`; inside it, each element.
    [
      "beside a fragment's own $1",
      "fn dbl(xs: List(Int)) -> List(Int) = $1.map($1 * 2)",
      "List(Int)",
      "dbl([1, 2])",
      [2, 4],
    ],
    // `fold`'s seed is a value, so its `$2` is the fn's `start`; the fragment
    // binds `$1` / `$2` to the accumulator and the element.
    [
      "beside a fragment's own $1 and $2",
      "fn sum-from(xs: List(Int), start: Int) -> Int = xs.fold($2, $1 + $2)",
      "Int",
      "sum-from([1, 2, 3], 10)",
      16,
    ],
  ])("%s", async (_label, fn, type, call, want) => {
    const shape = await loadSource(app(fn, type, call));
    const report = await runScenario(shape, freshRoot(), {
      steps: [{ do: { dispatch: "go" }, expect: { noErrors: true } }],
    });
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(shape.live?.res).toEqual(want);
  });
});
