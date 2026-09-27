// `check` and `build` must never disagree about a method call: whatever the
// checker accepts, codegen lowers. A lowering that dereferences an argument the
// call was not given crashes `compile()` with a bare `TypeError` naming no file
// or line — after `check` has already said ok.
//
// The arity rules live in the checker (`METHOD_MIN_ARGS`, and the receiver-
// decided counts of `.get` / `.get-or`) and the argument reads live in
// `methodCallJs`, so this walks every method the runtime knows, on every kind
// of receiver the checker tells apart (including one it cannot decide), at
// every small count. A call the checker rejects is fine; a call it accepts
// has to compile.

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
    // The walk reached codegen at all: a harness whose every program the
    // checker rejects would pass the line above without lowering anything.
    expect(compiled).toBeGreaterThan(0);
  });
});
