import { check, lex, parse } from "@kumikijs/compiler";
import { runScenario } from "@kumikijs/runtime";
import { expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

it("binds an Option's list payload whole in a fragment beside a union that declares Some", async () => {
  // A fragment's `$1` is decided by the receiver's type, so the receiver has to stay an
  // `Option(List(Int))` for `$1` to be the list rather than its first item.
  const source = withApp(`type Pick = Some(Int) | Nothing
slot n : Option(Int) = None

reducer go on=ui.click(Go)
    do= let o = Some([1, 2])
        n := o.map($1.length)

tile Go = button(text="go") {id: "go"}
tile App = column(Go)`);
  expect(check(parse(lex(source))).filter((e) => e.severity !== "warning")).toEqual([]);
  const shape = await loadSource(source);
  const report = await withRoot((root) =>
    runScenario(shape, root, { steps: [{ do: { click: "#go" }, expect: { noErrors: true } }] }),
  );
  expect(report.ok, failureDetail(report)).toBe(true);
  expect(shape.live).toMatchObject({ n: { _tag: "Some", _0: 2 } });
});
