// A Set literal is a Set (stdlib.md §2.2.2). A list literal written where a
// `Set` is declared used to lower to a JavaScript array, while every Set
// member reads a Set as `{ [key]: true }` — so `slot s : Set(Int) = [5]`
// answered `has(5)` false, counted `[5, 5]` as two, and `add(5)` produced the
// mix `{"0": 5, "5": true}`. `check` said `ok`.
//
// The first block renders a literal-initialised Set through each member of
// §2.2.2 and reads it off the page; every row fails on an array. (`diff`'s
// `size` half reads 1 on either form — its `has` half is the one that tells
// them apart.) The second pins that the form does not depend on where the
// literal is written: a record field, a reducer write, a `fn` argument, a
// member's argument, a `let … in` body, a test's slots. The literal as a Set
// operand is the argument of the `union` / `intersect` / `diff` rows above.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "124-set-literal.kumiki");

const DEFS = `type Bag = {tags: Set(Text)}
type P   = {x: Int}
type C   = Red | Blue
slot s     : Set(Int)            = [5, 5]
slot w     : Set(Text)           = ["a", "b"]
slot bag   : Bag                 = {tags: ["x"]}
slot n     : Int                 = 0
slot seen  : Int                 = 0
slot ls    : List(Set(Int))      = [[1]]
slot m     : Map(Text, Set(Int)) = {}
slot lt    : Set(Int)            = []
slot recs  : Set(P)              = [{x: 1}, {x: 2}]
slot recs2 : Set(P)              = {}
slot cs    : Set(C)              = [Red, Blue]
slot cs2   : Set(C)              = {}
fn count(x: Set(Text)) -> Int = x.size
reducer go on=ui.click(Go) do=
    w := ["c", "c"]
    seen := count(["p", "p", "q"])
    ls := ls.push([2, 2])
    m := m.insert("k", [1, 1])
    lt := let x = 3 in [x, x]
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
    ["remove", '"r=" + w.remove("a").has("b").show + w.remove("a").size.show', "r=true1"],
    ["toggle", '"r=" + w.toggle("a").has("a").show + w.toggle("a").size.show', "r=false1"],
    ["union", '"r=" + w.union(["b", "c"]).size.show', "r=3"],
    ["intersect", '"r=" + w.intersect(["b", "c"]).size.show', "r=1"],
    ["diff", '"r=" + w.diff(["b"]).size.show + w.diff(["b"]).has("a").show', "r=1true"],
    ["to-list", '"r=" + s.to-list.length.show + " " + s.to-list.fold(0, $1 + $2).show', "r=1 5"],
  ])("%s", async (_member, shown, want) => {
    // The `;` ends the value, so `r=1` does not also match `r=10`.
    expect(await render(`${shown} + ";"`)).toContain(`${want};`);
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

  it("in a member's argument whose type the receiver fixes", async () => {
    const text = await render(
      '"r=" + ls.contains([1]).show + ls.contains([2]).show + m.get-or("k", {}).size.show',
      1,
    );
    expect(text).toContain("r=truetrue1");
  });

  it("in a let … in body", async () => {
    expect(await render('"r=" + lt.has(3).show + lt.size.show', 1)).toContain("r=true1");
  });

  it("is the form add builds, not an array or a mix", async () => {
    const shape = await loadSource(`${DEFS}
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`);
    await runScenario(shape, document.body.appendChild(document.createElement("div")), {
      steps: [{ expect: { noErrors: true } }],
    });
    expect(shape.live?.s).toEqual({ "5": true });
    expect(shape.live?.w).toEqual({ a: true, b: true });
    expect(shape.live?.bag).toEqual({ tags: { x: true } });
  });

  // A record or variant member is keyed the way `add` keys it — whatever that
  // is — so the literal and the `add` chain agree on the members they hold.
  it("of records or variants, holds what the add chain of the same members holds", async () => {
    const text = await render(
      '"r=" + (recs.size == recs2.add({x: 1}).add({x: 2}).size).show' +
        " + (recs.has({x: 3}) == recs2.add({x: 1}).add({x: 2}).has({x: 3})).show" +
        " + (cs.size == cs2.add(Red).add(Blue).size).show",
    );
    expect(text).toContain("r=truetruetrue");
  });

  it("in a reducer-test's given and expect slots", { timeout: 30_000 }, async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["rebuild-writes-a-set:true"]);
  });
});

/** Run every `test` in `defs` (plus a clickable `Go` and an app) and answer `name:pass`. */
async function runTests(defs: string, caps = "[]"): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "kumiki-set-literal-"));
  const file = join(dir, "app.kumiki");
  writeFileSync(
    file,
    `${defs}
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = ${caps}
    routes = {"/" -> App, "/404" -> App}
    init   = []`,
  );
  try {
    return (await testFile(file)).map(
      (r) => `${r.name}:${r.pass}${r.diffAt ? ` @${r.diffAt}` : ""}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("a Set literal in a reducer-test", () => {
  it("seeds the given slot as a Set, so a repeated member counts once", {
    timeout: 30_000,
  }, async () => {
    expect(
      await runTests(`slot w    : Set(Text) = []
slot seen : Int       = 0
reducer measure on=ui.click(Go) do= seen := w.size
test counts-members = reducer-test measure
    given  = {slots: {w: ["a", "a", "b"]}, event: {type: ui.click, target: Go}}
    expect = {slots: {seen: 2}}`),
    ).toEqual(["counts-members:true"]);
  });

  it("is built as a Set in an expected effect's argument", { timeout: 30_000 }, async () => {
    expect(
      await runTests(
        `effect save cap=storage.write in=Set(Text) out=Result(Unit, Text)
slot w : Set(Text) = []
reducer emitSave on=ui.click(Go) do= emit save(w)
test emits-the-set = reducer-test emitSave
    given  = {slots: {w: ["a"]}, event: {type: ui.click, target: Go}}
    expect = {slots: {}, effects: [save(["a"])]}`,
        "[storage.write]",
      ),
    ).toEqual(["emits-the-set:true"]);
  });

  it("is built as a Set in a mocked result", { timeout: 30_000 }, async () => {
    expect(
      await runTests(
        `effect load cap=storage.read in=Unit out=Result(Set(Text), Text)
slot seen : Int = 0
reducer ask on=ui.click(Go) do= emit load()
reducer loaded on=load.ok($s) do= seen := $s.size
test loads-a-set = reducer-test ask
    given  = {event: {type: ui.click, target: Go}, mocks: {load: ok(["a", "a", "b"])}}
    expect = {slots: {seen: 2}}`,
        "[storage.read]",
      ),
    ).toEqual(["loads-a-set:true"]);
  });

  it("matches a generated member with <any-id>, one per wildcard", {
    timeout: 30_000,
  }, async () => {
    expect(
      await runTests(`type ItemId = nominal Text where uuid
slot sel : Set(ItemId) = {}
reducer pick on=ui.click(Go) do= sel := [ItemId.fresh()]
reducer pickTwo on=ui.click(Go) do= sel := [ItemId.fresh(), ItemId.fresh()]
test one-generated = reducer-test pick
    given  = {event: {type: ui.click, target: Go}}
    expect = {slots: {sel: [<any-id>]}}
test two-generated = reducer-test pickTwo
    given  = {event: {type: ui.click, target: Go}}
    expect = {slots: {sel: [<any-id>, <any-id>]}}
test one-is-not-two = reducer-test pickTwo
    given  = {event: {type: ui.click, target: Go}}
    expect = {slots: {sel: [<any-id>]}}`),
    ).toEqual(["one-generated:true", "two-generated:true", "one-is-not-two:false @slots.sel"]);
  });

  it("matches the written members exactly beside a wildcard", { timeout: 30_000 }, async () => {
    expect(
      await runTests(`type ItemId = nominal Text where uuid
slot sel  : Set(ItemId) = {}
slot kept : ItemId      = ItemId.fresh()
reducer grow on=ui.click(Go) do= sel := sel.add(ItemId.fresh())
test keeps-the-given = reducer-test grow
    given  = {slots: {sel: ["00000000-0000-4000-8000-000000000001"]}, event: {type: ui.click, target: Go}}
    expect = {slots: {sel: ["00000000-0000-4000-8000-000000000001", <any-id>]}}
test names-a-member-it-lacks = reducer-test grow
    given  = {slots: {sel: ["00000000-0000-4000-8000-000000000001"]}, event: {type: ui.click, target: Go}}
    expect = {slots: {sel: ["00000000-0000-4000-8000-000000000002", <any-id>]}}`),
    ).toEqual(["keeps-the-given:true", "names-a-member-it-lacks:false @slots.sel"]);
  });

  it("resolves a <slots.X> member to the slot's value after the reducer", {
    timeout: 30_000,
  }, async () => {
    expect(
      await runTests(`slot tags : Set(Text) = []
slot pick : Text      = ""
slot other : Text     = ""
reducer addTag on=ui.click(Go) do= tags := tags.add(pick)
test add-tag = reducer-test addTag
    given  = {slots: {tags: [], pick: "a"}, event: {type: ui.click, target: Go}}
    expect = {slots: {tags: [<slots.pick>]}}
test beside-a-literal = reducer-test addTag
    given  = {slots: {tags: ["z"], pick: "a"}, event: {type: ui.click, target: Go}}
    expect = {slots: {tags: ["z", <slots.pick>]}}
test names-a-value-it-lacks = reducer-test addTag
    given  = {slots: {tags: ["z"], pick: "a", other: "q"}, event: {type: ui.click, target: Go}}
    expect = {slots: {tags: ["a", <slots.other>]}}
test one-is-not-two = reducer-test addTag
    given  = {slots: {tags: ["z"], pick: "a"}, event: {type: ui.click, target: Go}}
    expect = {slots: {tags: [<slots.pick>]}}`),
    ).toEqual([
      "add-tag:true",
      "beside-a-literal:true",
      "names-a-value-it-lacks:false @slots.tags",
      "one-is-not-two:false @slots.tags",
    ]);
  });

  it("resolves a <slots.X> map key to the slot's value after the reducer", {
    timeout: 30_000,
  }, async () => {
    expect(
      await runTests(`slot counts : Map(Text, Int) = {}
slot pick   : Text           = ""
slot other  : Text           = ""
reducer bump on=ui.click(Go) do= counts := counts.insert(pick, 1)
test bumps = reducer-test bump
    given  = {slots: {counts: {"z": 2}, pick: "a"}, event: {type: ui.click, target: Go}}
    expect = {slots: {counts: {"z": 2, <slots.pick>: 1}}}
test names-a-key-it-lacks = reducer-test bump
    given  = {slots: {counts: {"z": 2}, pick: "a", other: "q"}, event: {type: ui.click, target: Go}}
    expect = {slots: {counts: {"z": 2, <slots.other>: 1}}}
test wrong-value = reducer-test bump
    given  = {slots: {counts: {"z": 2}, pick: "a"}, event: {type: ui.click, target: Go}}
    expect = {slots: {counts: {"z": 2, <slots.pick>: 5}}}`),
    ).toEqual([
      "bumps:true",
      "names-a-key-it-lacks:false @slots.counts",
      "wrong-value:false @slots.counts",
    ]);
  });

  it("expects an empty Set with []", { timeout: 30_000 }, async () => {
    expect(
      await runTests(`slot w : Set(Text) = ["a"]
reducer clear on=ui.click(Go) do= w := []
test clears = reducer-test clear
    given  = {event: {type: ui.click, target: Go}}
    expect = {slots: {w: []}}`),
    ).toEqual(["clears:true"]);
  });
});
