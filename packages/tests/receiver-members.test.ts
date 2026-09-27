// A member of one container written on another used to pass `check` and
// `build`, and the runtime answered with whichever container's reading the
// name reached: `res.filter(…)` on a `Result` read it as a `Map` and gave `{}`,
// `opt.keys` gave the Option's own `_tag` / `_0` as data. It is E0108 now, on
// both verbs.
//
// The checker's table, receiver by receiver and against the spec, is pinned in
// `packages/compiler/test/receiver-members.test.ts`; the spelling §2.2 gives
// each of these runs in `features/145-receiver-members` and its scenario.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (decls: string, body: string): string => `${decls}
reducer run on=ui.click(Run) do= ${body}
tile Run = button(text="run")
tile App = column(Run)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const ROWS: [string, string][] = [
  [
    'slot res : Result(Int, Text) = Ok(3)\nslot sink : Result(Int, Text) = Err("x")',
    "sink := res.filter($1 > 2)",
  ],
  ["slot opt : Option(Int) = Some(3)\nslot n : Int = 0", "n := opt.keys.length"],
  ["slot opt : Option(Int) = Some(3)\nslot n : Int = 0", "n := opt.size"],
  ["slot opt : Option(Int) = Some(3)\nslot n : Int = 0", "n := opt.entries.length"],
  ["slot res : Result(Int, Text) = Ok(3)\nslot n : Int = 0", "n := res.values.length"],
  ["slot st : Set(Int) = [1, 2, 3]\nslot n : Int = 0", "n := st.filter($1 > 1).size"],
  ["slot st : Set(Int) = [1, 2, 3]\nslot n : Int = 0", "n := st.map($1 * 2).length"],
];

describe("a member of another receiver", () => {
  it.each(ROWS)("%s / %s: check reports it and build refuses it", (decls, body) => {
    const src = app(decls, body);
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual(["E0108"]);
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(r.kind).toBe("fail");
    if (r.kind === "fail") expect(r.errors.map((e) => e.code)).toEqual(["E0108"]);
  });
});
