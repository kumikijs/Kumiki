import { check, lex, parse } from "@kumikijs/compiler";
import { runScenario } from "@kumikijs/runtime";
import { expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

// A fragment's `$1` is decided by the receiver's type, so the receiver has to stay an
// `Option(List(Int))` / `Result(List(Int), …)` for `$1` to be the list rather than its first item,
// whether or not a union of the program's own could hold the payload too.
it.each([
  [
    "a union whose Some refuses the payload",
    "type Pick = Some(Int) | Nothing",
    "Some",
    "Option(Int) = None",
  ],
  [
    "a union whose Some holds the payload",
    "type Pick = Some(List(Int)) | Nothing",
    "Some",
    "Option(Int) = None",
  ],
  [
    "a generic union whose Some holds any payload",
    "type Box(T) = Some(T) | Empty",
    "Some",
    "Option(Int) = None",
  ],
  [
    "a generic union whose Ok holds any payload",
    "type Outcome(T) = Ok(T) | Fail",
    "Ok",
    'Result(Int, Text) = Err("e")',
  ],
])("binds a list payload whole in a fragment beside %s", async (_label, decl, tag, slot) => {
  const source = withApp(`${decl}
slot n : ${slot}

reducer go on=ui.click(Go)
    do= let o = ${tag}([1, 2])
        n := o.map($1.length)

tile Go = button(text="go") {id: "go"}
tile App = column(Go)`);
  expect(check(parse(lex(source))).filter((e) => e.severity !== "warning")).toEqual([]);
  const shape = await loadSource(source);
  const report = await withRoot((root) =>
    runScenario(shape, root, { steps: [{ do: { click: "#go" }, expect: { noErrors: true } }] }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  expect(shape.live).toMatchObject({ n: { _tag: tag, _0: 2 } });
});
