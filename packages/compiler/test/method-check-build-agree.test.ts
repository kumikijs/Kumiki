import { compile, KNOWN_METHODS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const RECEIVERS: ReadonlyArray<[label: string, decl: string, recv: string]> = [
  // `$el` is untyped, so the checker decides nothing about its fields.
  ["an undecided receiver", "", "$el.x"],
  ["an Option", "slot v : Option(Int) = Some(1)", "v"],
  ["a Result", "slot v : Result(Int, Text) = Ok(1)", "v"],
  ["a Map", "slot v : Map(Text, Int) = {}", "v"],
  ["a List", "slot v : List(Int) = []", "v"],
  ["a Text", 'slot v : Text = ""', "v"],
  ["an Int", "slot v : Int = 0", "v"],
];

const program = (decl: string, call: string): string => `${decl}
slot sink : Text = ""
reducer act on=ui.click(Btn)
    do= sink := (${call}).show
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

describe("every method call check accepts is one build compiles", () => {
  it.each(RECEIVERS)("on %s", (_label, decl, recv) => {
    const crashed: string[] = [];
    let compiled = 0;
    for (const method of KNOWN_METHODS) {
      for (let count = 0; count <= 3; count++) {
        const args = Array.from({ length: count }, () => "1").join(", ");
        const call = `${recv}.${method}(${args})`;
        try {
          const r = compile(program(decl, call), { runtimeSpecifier: "./runtime.js" });
          if (r.kind === "ok") compiled++;
        } catch (err) {
          crashed.push(`${call}: ${(err as Error).message}`);
        }
      }
    }
    expect(crashed).toEqual([]);
    expect(compiled).toBeGreaterThan(0);
  });
});

describe(".get compiles in the reading its receiver has", () => {
  it.each([
    ["the unwrap on an Option", "slot v : Option(Int) = Some(1)", "v.get()"],
    ["the unwrap on a Result", "slot v : Result(Int, Text) = Ok(1)", "v.get()"],
    ["the unwrap on an undecided receiver", "", "$el.x.get()"],
    ["the lookup on a Map", "slot v : Map(Text, Int) = {}", 'v.get("k")'],
    ["the lookup on a List", "slot v : List(Int) = []", "v.get(0)"],
  ])("%s", (_label, decl, call) => {
    const r = compile(program(decl, call), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind === "fail" ? r.errors.map((e) => e.code) : []).toEqual([]);
  });
});

describe(".get is refused on the receivers that have no reading of it", () => {
  const spellings = [
    "v.get",
    ...[0, 1, 2, 3].map((n) => `v.get(${Array(n).fill("1").join(", ")})`),
  ];
  it.each(
    RECEIVERS.filter(([label]) => label === "a Text" || label === "an Int").flatMap(
      ([label, decl]) => spellings.map((call): [string, string, string] => [call, label, decl]),
    ),
  )("%s on %s is E0108", (call, _label, decl) => {
    const r = compile(program(decl, call), { runtimeSpecifier: "./runtime.js" });
    expect(r.kind === "fail" ? r.errors.map((e) => e.code) : []).toEqual(["E0108"]);
  });
});
