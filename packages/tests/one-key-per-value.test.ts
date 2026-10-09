import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const EXAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
  "features",
  "123-one-key-per-value.kumiki",
);

const TYPES = `type Color  = Red | Green | Blue
type ItemId = nominal Int
type Pt     = {x: Int, y: Int}`;

/** Declare `slots`, run `body` on one click, and return the page text and state after it. */
async function click(
  slots: string,
  body: string,
  shown: string,
): Promise<{ text: string; state: Record<string, unknown> }> {
  const src = `${TYPES}
${slots}
reducer go on=ui.click(Go) do=
${body
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text(${shown}))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  const root = document.createElement("div");
  document.body.appendChild(root);
  const report = await runScenario(await loadSource(src), root, {
    steps: [{ do: { click: "#go" }, expect: { noErrors: true } }],
  });
  expect(report.steps[0]?.failures).toEqual([]);
  return { text: report.steps[0]?.domText ?? "", state: report.steps[0]?.state ?? {} };
}

async function afterClick(slots: string, body: string, shown: string): Promise<string> {
  return (await click(slots, body, shown)).text;
}

describe("a union value is a Set element and a Map key of its own", () => {
  it("add(Red) makes only Red a member, and toggle(Green) adds Green beside it", async () => {
    const text = await afterClick(
      "slot s : Set(Color) = {}",
      "s := s.add(Red).toggle(Green)",
      '"n=" + s.size.show + " red=" + s.has(Red).show + " green=" + s.has(Green).show + " blue=" + s.has(Blue).show',
    );
    expect(text).toContain("n=2 red=true green=true blue=false");
  });

  it("an index write and an insert count two variants separately", async () => {
    const text = await afterClick(
      "slot m : Map(Color, Int) = {}",
      "m := m.insert(Green, 5)\nm[Red] := 1",
      '"n=" + m.size.show + " red=" + m.get-or(Red, 0).show + " green=" + m.get-or(Green, 0).show + " blue=" + m.get(Blue).is-some.show',
    );
    expect(text).toContain("n=2 red=1 green=5 blue=false");
  });
});

describe("a record key is one entry per value", () => {
  it("whatever order its fields were written in, and update finds it", async () => {
    const text = await afterClick(
      "slot m : Map(Pt, Text) = {}",
      'm := m.insert({x: 0, y: 1}, "a").insert({y: 1, x: 0}, "b").insert({x: 1, y: 0}, "c").update({y: 1, x: 0}, $1 + "!")',
      '"n=" + m.size.show + " at=" + m.get-or({x: 0, y: 1}, "-")',
    );
    expect(text).toContain("n=2 at=b!");
  });

  it("whatever order the fields of a record inside a payload or a record were written in", async () => {
    const text = await afterClick(
      "slot m : Map(Option(Pt), Text) = {}\nslot r : Map({a: Pt}, Text) = {}",
      'm := m.insert(Some({x: 0, y: 1}), "a").insert(Some({y: 1, x: 0}), "b")\nr := r.insert({a: {x: 0, y: 1}}, "a").insert({a: {y: 1, x: 0}}, "b")',
      '"m=" + m.size.show + " " + m.get-or(Some({x: 0, y: 1}), "-") + " r=" + r.size.show + " " + r.get-or({a: {x: 0, y: 1}}, "-")',
    );
    expect(text).toContain("m=1 b r=1 b");
  });

  it("union, intersect and diff meet members written in different field orders", async () => {
    const text = await afterClick(
      "slot a : Set(Pt) = {}\nslot b : Set(Pt) = {}",
      "a := a.add({x: 1, y: 2}).add({x: 3, y: 4})\nb := b.add({y: 2, x: 1})",
      '"u=" + a.union(b).size.show + " i=" + a.intersect(b).size.show + " d=" + a.diff(b).size.show',
    );
    expect(text).toContain("u=2 i=1 d=1");
  });
});

describe("the readers hand a structured key back as the value it was written from", () => {
  it("to-list, keys and entries answer the variants and records that were written", async () => {
    const { state } = await click(
      "slot s : Set(Color) = {}\nslot m : Map(Pt, Int) = {}\nslot listed : List(Color) = []\nslot keys : List(Pt) = []\nslot pairs : List(Tuple(Pt, Int)) = []",
      "listed := s.add(Blue).to-list\nkeys := m.insert({y: 3, x: 2}, 7).keys\npairs := m.insert({x: 2, y: 3}, 7).entries",
      '"read"',
    );
    expect(state.listed).toEqual([{ _tag: "Blue" }]);
    expect(state.keys).toEqual([{ x: 2, y: 3 }]);
    expect(state.pairs).toEqual([[{ x: 2, y: 3 }, 7]]);
  });
});

describe("remove takes out the entry add and insert put in", () => {
  it.each([
    [
      "an Int Map key",
      'slot c : Map(Int, Text) = {1: "a", 2: "b"}',
      "c := c.remove(1)",
      "c.has(1)",
    ],
    ["an Int Set member", "slot c : Set(Int) = {}", "c := c.add(1).add(2).remove(1)", "c.has(1)"],
    [
      "a nominal-Int Map key",
      "slot c : Map(ItemId, Text) = {}",
      'c := c.insert(ItemId(1), "a").insert(ItemId(2), "b").remove(ItemId(1))',
      "c.has(ItemId(1))",
    ],
    [
      "a Bool Set member",
      "slot c : Set(Bool) = {}",
      "c := c.add(true).add(false).remove(true)",
      "c.has(true)",
    ],
    [
      "a Float Set member",
      "slot c : Set(Float) = {}",
      "c := c.add(1.5).add(2.5).remove(1.5)",
      "c.has(1.5)",
    ],
    [
      "a variant Set member",
      "slot c : Set(Color) = {}",
      "c := c.add(Red).add(Blue).remove(Red)",
      "c.has(Red)",
    ],
  ])("%s", async (_what, slot, body, has) => {
    const text = await afterClick(slot, body, `"n=" + c.size.show + " has=" + ${has}.show`);
    expect(text).toContain("n=1 has=false");
  });
});

describe("a key written in a Map literal is stored the way insert stores it", () => {
  it.each([
    [
      "a record key, found whatever order its fields are written in",
      "slot m : Map(Pt, Text) = {}\nslot ks : List(Pt) = []",
      'm := {{y: 2, x: 1}: "a"}\nks := m.keys',
      '"n=" + m.size.show + " has=" + m.has({x: 1, y: 2}).show + " at=" + m.get-or({x: 1, y: 2}, "-") + " grown=" + m.insert({x: 1, y: 2}, "b").size.show',
      { ks: [{ x: 1, y: 2 }] },
    ],
    [
      "a variant key with a payload",
      "slot m : Map(Option(Int), Text) = {}\nslot ks : List(Option(Int)) = []",
      'm := {Some(1): "a"}\nks := m.keys',
      '"n=" + m.size.show + " has=" + m.has(Some(1)).show + " at=" + m.get-or(Some(1), "-") + " grown=" + m.insert(Some(1), "b").size.show',
      { ks: [{ _tag: "Some", _0: 1 }] },
    ],
    [
      "a tuple key",
      "slot m : Map(Tuple(Int, Int), Text) = {}\nslot ks : List(Tuple(Int, Int)) = []",
      'm := {(1, 2): "a"}\nks := m.keys',
      '"n=" + m.size.show + " has=" + m.has((1, 2)).show + " at=" + m.get-or((1, 2), "-") + " grown=" + m.insert((1, 2), "b").size.show',
      { ks: [[1, 2]] },
    ],
  ])("%s", async (_what, slots, body, shown, keys) => {
    const { text, state } = await click(slots, body, shown);
    expect(text).toContain("n=1 has=true at=a grown=1");
    expect(state).toMatchObject(keys);
  });

  it("is gated like an inserted key, so a refined value in it is refused, not a crash", async () => {
    const src = `${TYPES}
slot m : Map(Pt, Text where nonempty) = {}
reducer go on=ui.click(Go) do=
    m := {{x: 0, y: 0}: ""}
tile Go = button(text="go") {id: "go"}
tile App = column(Go, text("n=" + m.size.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
    const root = document.createElement("div");
    document.body.appendChild(root);
    const report = await runScenario(await loadSource(src), root, {
      steps: [{ do: { click: "#go" }, expect: { noErrors: true } }],
    });
    const failures = JSON.stringify(report.steps[0]?.failures);
    expect(failures).toContain("nonempty");
    expect(failures).not.toContain("JSON");
    expect(report.steps[0]?.domText).toContain("n=0");
  });

  it("in a reducer test's expected state, equals the Map the reducer built", async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => `${r.name}:${r.pass}`)).toEqual(["mark-writes-two-cells:true"]);
  });
});

describe("a Map's filter hands its predicate the key and the value, whatever shape the key has", () => {
  it("binds $2 to the value on a tuple-keyed Map", async () => {
    const { state } = await click(
      "slot m : Map(Tuple(Int, Int), Int) = {(1, 2): 10, (3, 4): 0}\nslot ks : List(Tuple(Int, Int)) = []",
      "ks := m.filter($2 > 0).keys",
      '"read"',
    );
    expect(state.ks).toEqual([[1, 2]]);
  });

  it("binds $1 to the whole tuple key", async () => {
    const { state } = await click(
      "slot m : Map(Tuple(Int, Int), Int) = {}\nslot ks : List(Tuple(Int, Int)) = []",
      "ks := m.insert((1, 2), 10).insert((3, 4), 0).filter($1 == (3, 4)).keys",
      '"read"',
    );
    expect(state.ks).toEqual([[3, 4]]);
  });
});
