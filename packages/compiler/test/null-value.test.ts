// `null` is reserved, and a program may not use it (language.md §1.2.2,
// §1.9.1): Kumiki has no null, and a value that may be absent is an `Option`.
// The parser reads `null` wherever an expression goes, and the checker reports
// it there as E0235 with that fix: one diagnostic, at the `null`, whatever the
// expression around it. Where a record field name goes instead, `null` is a
// parse error (`record-or-map-literal.test.ts`), as `true` is.

import { check, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string, caps = ""): string => `${defs}
tile B = button(text="x")
tile Home = column(B)
app R
    caps   = [${caps}]
    routes = {"/" -> Home, "/404" -> Home}
    init   = []`;

/** Every diagnostic as `code kind` and the source text it points at, four characters of it. */
function diagnose(defs: string, caps = ""): string[] {
  const src = app(defs, caps);
  const lines = src.split("\n");
  return check(parse(lex(src))).map((e) => {
    const at = (lines[e.pos.line - 1] ?? "").slice(e.pos.col - 1, e.pos.col + 3);
    return `${e.code} ${e.kind} ${at}`;
  });
}

const LOAD = `effect load cap=storage.read in=Text out=Result(Text, Text) map-request={key: $1, decode: Decoder.Json(Text)}`;

describe("`null` where an expression goes is E0235 at the `null`, and nothing else", () => {
  it.each([
    ["a slot's initial value", "slot s : Option(Int) = null"],
    ["a record literal's field value", "slot r : {a: Option(Int)} = {a: null}"],
    ["a list item", "slot xs : List(Int) = [1, null]"],
    ["a Map value", 'slot m : Map(Text, Int) = {"a": null}'],
    ["a variant payload", "slot o : Option(Int) = Some(null)"],
    ["the right of a comparison", "fn absent(x: Option(Int)) -> Bool = x == null"],
    ["the left of a comparison", "fn absent(x: Option(Int)) -> Bool = null == x"],
    ["a fn body", "fn none() -> Option(Int) = null"],
    ["a fn argument", "fn id(x: Int) -> Int = x\nslot s : Int = id(null)"],
    ["an `if` branch", "fn pick(c: Bool, x: Int) -> Int = if c then x else null"],
    ["a `let` value", "fn f(x: Int) -> Int = let y = null in x"],
    ["a `match` scrutinee", "fn f(x: Int) -> Int = match null with | _ -> x"],
    ["a method argument", "fn f(x: Option(Int)) -> Int = x.get-or(null)"],
    ["a reducer write", "slot s : Option(Int) = None\nreducer clear on=ui.click(B) do= s := null"],
    ["a value builtin's content", "tile Lbl = text(null)"],
  ])("in %s", (_where, defs) => {
    expect(diagnose(defs)).toEqual(["E0235 null-value null"]);
  });

  it("in an `emit` argument", () => {
    expect(
      diagnose(`${LOAD}\nreducer r on=ui.click(B) do= emit load(null)`, "storage.read"),
    ).toEqual(["E0235 null-value null"]);
  });

  it("names the Option that stands for an absent value", () => {
    const [e] = check(parse(lex(app("slot s : Option(Int) = null"))));
    expect(e).toMatchObject({
      code: "E0235",
      kind: "null-value",
      message:
        "`null` is not a value — Kumiki has no null. Where a value may be absent, declare Option(T) and write None for no value, Some(x) for one",
      pos: { line: 1, col: 24 },
    });
  });
});

describe("`null` has no lowering", () => {
  // Every `null` a program can write is E0235, so only `codegen()` called
  // without `check()` meets one — and gets an error naming it rather than a
  // JavaScript `null` that no Kumiki type holds.
  it("so codegen without check refuses it at its position", () => {
    const program = parse(lex(app("slot s : Option(Int) = null")));
    expect(() => codegen(program, { runtimeSpecifier: "./runtime.js" })).toThrow(
      "`null` at 1:24 has no lowering — run `check` for the diagnostic",
    );
  });
});
