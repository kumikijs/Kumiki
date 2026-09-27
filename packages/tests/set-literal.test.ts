// A Set literal is a Set (stdlib.md §2.2.2). A list literal written where a
// `Set` is declared used to lower to a JavaScript array, while every Set
// member reads a Set as `{ [key]: true }` — so `slot s : Set(Int) = [5]`
// answered `has(5)` false, counted `[5, 5]` as two, and `add(5)` produced the
// mix `{"0": 5, "5": true}`. `check` said `ok`.
//
// Each row renders a literal-initialised Set through one member of §2.2.2 and
// reads it off the page; every row reads the literal itself, so each fails on
// an array. The rows that declare the literal elsewhere — a record field, a
// `fn` argument, a reducer write, a Set operand, a test's slots — pin that
// the form does not depend on where the literal is written.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "124-set-literal.kumiki");

const DEFS = `type Bag = {tags: Set(Text)}
slot s    : Set(Int)  = [5, 5]
slot w    : Set(Text) = ["a", "b"]
slot bag  : Bag       = {tags: ["x"]}
slot n    : Int       = 0
slot seen : Int       = 0
fn count(x: Set(Text)) -> Int = x.size
reducer go on=ui.click(Go) do=
    w := ["c", "c"]
    seen := count(["p", "p", "q"])
tile Go = button(text="go") {id: "go"}`;

/** Render `shown` after `clicks` clicks on Go and return the page text. */
async function render(shown: string, clicks = 0): Promise<string> {
  const src = `${DEFS}
tile App = column(Go, text(${shown}))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  const root = document.createElement("div");
  document.body.appendChild(root);
  const steps = [
    ...Array.from({ length: clicks }, () => ({ do: { click: "#go" }, expect: {} })),
    { expect: { noErrors: true } },
  ];
  const report = await runScenario(await loadSource(src), root, { steps });
  return report.steps.at(-1)?.domText ?? "";
}

describe("a literal-initialised Set, through each member of stdlib.md §2.2.2", () => {
  it.each([
    ["size", '"r=" + s.size.show', "r=1"],
    ["has", '"r=" + s.has(5).show', "r=true"],
    ["add of a member already there", '"r=" + s.add(5).size.show', "r=1"],
    ["add of a new member", '"r=" + s.add(6).has(6).show + s.add(6).size.show', "r=true2"],
    ["remove", '"r=" + w.remove("a").has("a").show + w.remove("a").size.show', "r=false1"],
    ["toggle", '"r=" + w.toggle("a").has("a").show + w.toggle("a").size.show', "r=false1"],
    ["union", '"r=" + w.union(["b", "c"]).size.show', "r=3"],
    ["intersect", '"r=" + w.intersect(["b", "c"]).size.show', "r=1"],
    ["diff", '"r=" + w.diff(["b"]).size.show + w.diff(["b"]).has("a").show', "r=1true"],
    ["to-list", '"r=" + s.to-list.length.show + " " + s.to-list.fold(0, $1 + $2).show', "r=1 5"],
  ])("%s", async (_member, shown, want) => {
    expect(await render(shown)).toContain(want);
  });
});

describe("the literal is a Set wherever it is written", () => {
  it("in a record field", async () => {
    expect(await render('"r=" + bag.tags.has("x").show')).toContain("r=true");
  });

  it("in a reducer write and a fn argument", async () => {
    const text = await render('"r=" + w.size.show + w.has("c").show + " seen=" + seen.show', 1);
    expect(text).toContain("r=1true seen=2");
  });

  it("in a reducer-test's given and expect slots", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["rebuild-writes-a-set:true"]);
  });
});
