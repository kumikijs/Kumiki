import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const APP = `tile Run = button(text="run")
tile App = column(Run)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const FNS = `fn three(a: Int, b: Int, c: Int) -> Bool = a + b + c > 0
fn zero() -> Bool = true
`;

/** The codes `check` reports for a `fn` over `v : type` whose body reads `expr`. */
function fnCodes(type: string, expr: string): string[] {
  const src = `type R = {x: Int}\n${FNS}fn probe(v: ${type}) -> Text = (${expr}).show\n${APP}`;
  return check(parse(lex(src))).map((e) => e.code);
}

/** The codes `check` reports for a reducer over `decls` that writes `sink := (expr).show`. */
function codes(decls: string, expr: string): string[] {
  const src = `${decls}
slot sink : Text = ""
reducer run on=ui.click(Run) do= sink := (${expr}).show
${APP}`;
  return check(parse(lex(src))).map((e) => e.code);
}

const KNOWN = [
  "Text",
  "Int",
  "Float",
  "Bool",
  "Set(Int)",
  "Time",
  "Duration",
  "Bytes",
  "File",
  "R",
];

const SPELLINGS = ["v.get", "v.get()", "v.get(1)", "v.get(1, 2)", "v.get(1, 2, 3)"];

describe(".get on a known receiver that has none is E0108, and only that", () => {
  for (const type of KNOWN) {
    for (const spelling of SPELLINGS) {
      it(`${spelling} on ${type}`, () => {
        expect(fnCodes(type, spelling)).toEqual(["E0108"]);
      });
    }
  }
});

describe("one diagnostic for a member the receiver lacks, whatever the member", () => {
  it.each([
    ["Text", "v.filter()"],
    ["Text", "v.filter(three)"],
    ["Text", "v.filter(zero)"],
    ["Int", "v.map(three)"],
    ["Text", "v.sort-by(three)"],
    ["Text", "v.pow()"],
    ["Int", "v.get-or(1, 2, 3)"],
    ["Int", "v.get-or()"],
  ])("on %s, %s is E0108 alone", (type, expr) => {
    expect(fnCodes(type, expr)).toEqual(["E0108"]);
  });
});

describe(".get where the receiver has it, or cannot be decided", () => {
  it("a record that declares a field `get` reads it", () => {
    expect(codes("type G = {get: Int}\nslot g : G = {get: 7}", "g.get")).toEqual([]);
  });

  it.each(["$el.x.get", "$el.x.get()", "$el.x.get(1)"])("%s passes", (expr) => {
    expect(codes("", expr)).toEqual([]);
  });

  it("a count past both readings is still E0213 on an undecided receiver", () => {
    expect(codes("", "$el.x.get(1, 2)")).toEqual(["E0213"]);
  });

  it.each([
    ["o.get()", "slot o : Option(Int) = Some(1)"],
    ["r.get()", "slot r : Result(Int, Text) = Ok(1)"],
    ['m.get("k")', "slot m : Map(Text, Int) = {}"],
    ["xs.get(0)", "slot xs : List(Int) = []"],
  ])("%s, a reading its receiver has, passes", (expr, decls) => {
    expect(codes(decls, expr)).toEqual([]);
  });
});
