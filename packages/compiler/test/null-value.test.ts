import { codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, nullValueMessage, posOf, textAt } from "./helpers/diagnostics.ts";
import { LOAD_EFFECT, withButtonApp } from "./helpers/programs.ts";

function diagnose(defs: string, caps = ""): string[] {
  const src = withButtonApp(defs, { caps });
  return checkSource(src).map((e) => `${e.code} ${e.kind} ${textAt(src, e.pos).slice(0, 4)}`);
}

/** A reducer-test of a click counter, with `event` given and `effects` expected as written. */
const counterTest = (event: string, effects = "[]"): string => `slot clicks : Int = 0
reducer inc on=ui.click(B) do= clicks := clicks + 1
test t =
    reducer-test inc
        given  = {slots: {clicks: 0}, event: ${event}}
        expect = {slots: {clicks: 1}, effects: ${effects}}`;

describe("`null` where an expression goes is E0235 at the `null`, and nothing else", () => {
  it.each<[string, string, string?]>([
    ["a slot's initial value", "slot s : Option(Int) = null"],
    ["a record literal's field value", "slot r : {a: Option(Int)} = {a: null}"],
    ["a list item", "slot xs : List(Int) = [1, null]"],
    ["a Map value", 'slot m : Map(Text, Int) = {"a": null}'],
    ["a Map key that is not the first", 'slot m : Map(Text, Int) = {"a": 1, null: 2}'],
    ["a variant payload", "slot o : Option(Int) = Some(null)"],
    ["the right of a comparison", "fn absent(x: Option(Int)) -> Bool = x == null"],
    ["the left of a comparison", "fn absent(x: Option(Int)) -> Bool = null == x"],
    ["a fn body", "fn none() -> Option(Int) = null"],
    ["a fn argument", "fn id(x: Int) -> Int = x\nslot s : Int = id(null)"],
    ["an `if` condition", "fn f(x: Int) -> Int = if null then x else x"],
    ["an `if` branch", "fn pick(c: Bool, x: Int) -> Int = if c then x else null"],
    ["a `let` value", "fn f(x: Int) -> Int = let y = null in x"],
    ["a `match` scrutinee", "fn f(x: Int) -> Int = match null with | _ -> x"],
    ["a method argument", "fn f(x: Option(Int)) -> Int = x.get-or(null)"],
    ["a reducer write", "slot s : Option(Int) = None\nreducer clear on=ui.click(B) do= s := null"],
    [
      "an `emit` argument",
      `${LOAD_EFFECT}\nreducer r on=ui.click(B) do= emit load(null)`,
      "storage.read",
    ],
    ["a value builtin's content", "tile Lbl = text(null)"],
    ["a builtin's named argument", "tile Lbl = button(text=null)"],
    ["an input's bind", "tile In = input(bind=null)"],
    ["an error's field", "tile Err = error(field=null)"],
    ["a test event's type", counterTest("{type: null, target: B}")],
    ["a test event's target", counterTest("{type: ui.click, target: null}")],
    ["an expected effect", counterTest("{type: ui.click, target: B}", "[null]")],
  ])("in %s", (_where, defs, caps) => {
    expect(diagnose(defs, caps)).toEqual(["E0235 null-value null"]);
  });

  it("names the Option that stands for an absent value", () => {
    const src = withButtonApp("slot s : Option(Int) = null");
    const [e] = checkSource(src);
    expect(e).toMatchObject({
      code: "E0235",
      kind: "null-value",
      message: nullValueMessage,
      pos: posOf(src, "null"),
    });
  });
});

describe("`null` where a builtin renders its positional arguments as children", () => {
  it("is E0128 alone, which checks nothing inside the value", () => {
    expect(diagnose("tile L = column(null)")).toEqual(["E0128 value-as-child null"]);
  });
});

describe("`null` has no lowering", () => {
  it("so codegen without check refuses it at its position, not as the unit value", () => {
    const src = withButtonApp("slot s : Option(Int) = null");
    const { line, col } = posOf(src, "null");
    expect(() => codegen(parse(lex(src)), { runtimeSpecifier: "./runtime.js" })).toThrow(
      `\`null\` at ${line}:${col} has no lowering — run \`check\` for the diagnostic`,
    );
  });
});
