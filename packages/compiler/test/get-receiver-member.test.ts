// `.get` is a member of `Option` / `Result` / `Map` / `List` only (stdlib.md
// §2.2.1 / §2.2.3 / §2.2.4 / §2.2.5). On any other receiver the checker knows,
// every spelling of it — `.get`, `.get()`, `.get(k)`, and a count no reading
// takes — is one mistake: the receiver has no such member, E0108 and nothing
// else. An argument count is a question about a member the receiver has; asked
// of one it lacks, it has no answer to give, and saying E0213 besides would
// report the one mistake twice.
//
// A receiver whose type cannot be decided keeps the name-based dispatch
// §2.2.3 leaves it, so it stays unreported — apart from a count past both
// readings, which no receiver takes.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const APP = `tile Run = button(text="run")
tile App = column(Run)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

// Fns a fragment argument can name: one takes more arguments than any member
// hands it, one takes none.
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

// Every receiver with a row in the member table that has no `.get`, and a
// record — `R` has no field of that name.
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
  // The rule is not `.get`'s alone: an arity check on a member the receiver
  // does not have is the same second report for any name — the call's own
  // count, or the count the member would hand a fn named as its fragment.
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
