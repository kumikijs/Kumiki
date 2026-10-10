import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

describe("a member read off a `let … in` is lowered by its type", () => {
  // Undecided, a member is lowered by its name: `.size` counts a record's fields, `.keys` are text.
  it("reads a record field and a map's Int keys", async () => {
    const src = withApp(`type Box = {size: Int, label: Text}
fn sizeOf(b: Box) -> Int = (let inner = b in inner).size
slot box    : Box            = {size: 7, label: "seven"}
slot counts : Map(Int, Text) = {1: "one", 20: "twenty"}
slot got    : Int            = 0
slot keys   : List(Int)      = []
slot sum    : Int            = 0
reducer go on=ui.click(B)
    do= got := sizeOf(box)
        keys := (let m = counts in m).keys
        sum := (let m = counts in m).keys.fold(0, $1 + $2)
tile B = button(text="x")
tile App = column(B)`);
    const app = await loadSource(src);
    const report = await withRoot((root) =>
      runScenario(app, root, { steps: [{ do: { click: "button" }, expect: { noErrors: true } }] }),
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps.at(-1)?.state).toMatchObject({ got: 7, keys: [1, 20], sum: 21 });
  });
});
