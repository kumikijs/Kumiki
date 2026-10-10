import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";
import { withRoot } from "./helpers/programs.ts";

const ARGLESS: [method: string, receiver: string][] = [
  ["head", "xs"],
  ["tail", "xs"],
  ["last", "xs"],
  ["to-list", "st"],
  ["get-err", "r"],
  ["to-option", "r"],
  ["parse-int", "t"],
  ["parse-float", "t"],
  ["abs", "v"],
  ["neg", "v"],
  ["to-float", "v"],
  ["to-int", "f"],
];

function appSrc(body: string): string {
  return `slot v : Int = 0
slot f : Float = 0.0
slot t : Text = ""
slot xs : List(Int) = []
slot st : Set(Int) = []
slot r : Result(Int, Text) = Ok(0)
tile App = column(${body})
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
}

describe("argument-less stdlib methods", () => {
  it("the parenthesized form no longer trips E0801", () => {
    const body = ARGLESS.map(([m, v]) => `heading((${v}.${m}()).show)`).join(", ");
    const errs = checkSource(appSrc(body));
    expect(errs.filter((e) => e.code === "E0801")).toEqual([]);
  });

  it("the no-paren form lowers to the runtime helper, not a silent `undefined`", () => {
    const body = ARGLESS.map(([m, v]) => `heading((${v}.${m}).show)`).join(", ");
    const js = compileOrFail(appSrc(body));
    expect(js).toContain("_s.listHead(");
    expect(js).toContain("_s.listTail(");
    expect(js).toContain("_s.listLast(");
    expect(js).toContain("_s.toList(");
    expect(js).toContain("_s.getErr(");
    expect(js).toContain("_s.toOption(");
    expect(js).toContain("_s.parseIntOpt(");
    expect(js).toContain("_s.parseFloatOpt(");
    expect(js).toContain("Math.abs(");
    expect(js).toContain("Math.trunc(");
    for (const [m] of ARGLESS) expect(js, m).not.toContain(`["${m}"]`);
  });

  it("the parenthesized form lowers identically", () => {
    const body = ARGLESS.map(([m, v]) => `heading((${v}.${m}()).show)`).join(", ");
    const js = compileOrFail(appSrc(body));
    expect(js).toContain("_s.listHead(");
    expect(js).toContain("_s.toOption(");
    expect(js).toContain("Math.trunc(");
  });
});

// No spelling of a reading carries a copy of the rule of its own, so none can read a text
// differently from the others.
describe("every spelling of an Int or Float reading lowers to the one helper", () => {
  const src = `type Cents = nominal Int where positive
type Ratio = nominal Float
slot t : Text = ""
slot n : Int = 0
slot x : Float = 0.0
slot a : Option(Int) = None
slot b : Option(Cents) = None
slot c : Option(Float) = None
slot d : Option(Ratio) = None
reducer go on=ui.click(Go)
    do= a := Int.parse(t)
        b := Cents.parse(t)
        c := Float.parse(t)
        d := Ratio.parse(t)
tile Go = button(text="go")
tile App = column(Go,
    input(bind=n, type="number"),
    input(bind=x, type="number"),
    heading(t.parse-int.get-or(0).show),
    heading(t.parse-float().get-or(0.0).show))
tile Missing = text("missing")
app A
    caps   = []
    routes = {"/" -> App, "/404" -> Missing}
    init   = []`;

  const calls = (js: string, helper: string): number => js.split(`_s.${helper}(`).length - 1;

  it("reads every Int and every Float through its base's helper", () => {
    const js = compileOrFail(src);
    // Int.parse, Cents.parse, the bound `n`'s reader, and .parse-int.
    expect(calls(js, "parseIntOpt")).toBe(4);
    // Float.parse, Ratio.parse, the bound `x`'s reader, and .parse-float().
    expect(calls(js, "parseFloatOpt")).toBe(4);
    // The decimal-digit pattern is the helper's, and appears nowhere else.
    expect(js).not.toContain("[0-9]");
  });
});

describe("a method called with too few arguments is E0213", () => {
  it("reports the zero-arg call `check` used to pass", () => {
    const src = withRoot("text(stamp(Time.now))", "fn stamp(t: Time) -> Text = t.format()");
    expect(codesOf(src)).toEqual(["E0213"]);
  });

  it("covers the methods that were already like this, not only the new one", () => {
    const joinSrc = withRoot(
      "text(j(xs))",
      `slot xs : List(Text) = []
fn j(l: List(Text)) -> Text = l.join()`,
    );
    expect(codesOf(joinSrc)).toEqual(["E0213"]);
  });

  it("enforces the minimum, not an exact count", () => {
    const one = withRoot(
      "text(v(m))",
      `slot m : Map(Text, Text) = {}
fn v(x: Map(Text, Text)) -> Text = x.get-or("k", "fallback")`,
    );
    expect(codesOf(one)).toEqual([]);
    const opt = withRoot(
      "text(v(m))",
      `slot m : Map(Text, Text) = {}
fn v(x: Map(Text, Text)) -> Text = x.get("k").get-or("fallback")`,
    );
    expect(codesOf(opt)).toEqual([]);
  });

  it("says nothing about a method that takes none", () => {
    const src = withRoot("text(n.show)", "slot n : Int = 0");
    expect(codesOf(src)).toEqual([]);
  });
});
