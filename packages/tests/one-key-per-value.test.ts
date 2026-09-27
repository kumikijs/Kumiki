// A Set is `{ [key]: true }` and a Map a plain object, so each member turns a
// key into an object key. They used to disagree about how: `add` / `has` /
// `toggle` wrote `String(x)`, `get` / `insert` / `m[k]` / `m[k] := v` used the
// raw value as a property name, and `remove` compared the stored string with
// the raw key. So every union value and every record became the one key
// `"[object Object]"` — `picked.add(Red).has(Blue)` was true and `votes[Red]`
// and `votes[Green]` were one count — and `remove` on an `Int`, nominal-`Int`
// or `Bool` key removed nothing (stdlib.md §2.2.1 / §2.2.2: one key per value).
//
// Each case builds a container through the members a program would use, then
// reads it off the page after one click. Example 123 carries the same claims
// as a scenario.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

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
      '"n=" + m.size.show + " red=" + m.get-or(Red, 0).show + " green=" + m[Green].show + " blue=" + m.get(Blue).is-some.show',
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
