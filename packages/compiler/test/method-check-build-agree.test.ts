// `check` and `build` must never disagree about a method call: whatever the
// checker accepts, codegen lowers. A lowering that reads an argument the call
// was not given throws a bare `TypeError` out of `compile()`, naming no file or
// line.
//
// The argument counts are stated in codegen (`METHOD_MIN_ARGS`, next to the
// lowering that reads them) and enforced by the checker, which also decides
// `.get` / `.get-or` by receiver. So this walks every method codegen lowers
// (`KNOWN_METHODS`), on a spread of receivers — the four `.get` has readings
// on, an undecided one, and two it has none on — at every small count. A call
// the checker rejects is fine; a call it accepts has to compile.

import { compile, KNOWN_METHODS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const RECEIVERS: ReadonlyArray<[label: string, decl: string, recv: string]> = [
  // `$el` is untyped, so the checker decides nothing about its fields.
  ["an undecided receiver", "", "$el.x"],
  ["an Option", "slot v : Option(Int) = Some(1)", "v"],
  ["a Result", "slot v : Result(Int, Text) = Ok(1)", "v"],
  ["a Map", "slot v : Map(Text, Int) = {}", "v"],
  ["a List", "slot v : List(Int) = []", "v"],
  // Two receivers `.get` has no reading on. The checker does not refuse
  // `.get` on them yet, so all this walk asks of such a call is that it
  // compiles — not that it is right.
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
    // The walk reached codegen at all: a harness whose every program the
    // checker rejects would pass the line above without lowering anything.
    expect(compiled).toBeGreaterThan(0);
  });
});

// The walk above passes whether or not a call reaches codegen, so it would
// stay green if the checker began rejecting `.get`'s readings. Each reading
// is pinned here as compiling on the receivers that have it.
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
