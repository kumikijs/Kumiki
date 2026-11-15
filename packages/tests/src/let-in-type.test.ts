import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

describe("a bind with no type of its own, over a slot of its name", () => {
  // Typed as the slot `m : Box`, `.size` was lowered as `Box`'s field and wrote `undefined`.
  // `.map` with a fragment is what answers no type here.
  it("reads the member off the bound value, not off the slot's type", async () => {
    const src = withApp(`type Box = {size: Int, label: Text}
slot m   : Box       = {size: 7, label: "seven"}
slot xs  : List(Int) = [1, 2, 3]
slot got : Int       = 0
reducer go on=ui.click(B)
    do= got := let m = xs.map($1 * 2) in m.size
tile B = button(text="x")
tile App = column(B)`);
    const app = await loadSource(src);
    const report = await withRoot((root) =>
      runScenario(app, root, { steps: [{ do: { click: "button" }, expect: { noErrors: true } }] }),
    );
    expect(report.ok, failureDetail(report)).toBe(true);
    expect(report.steps.at(-1)?.state).toMatchObject({ got: 3 });
  });
});
