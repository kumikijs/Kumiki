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
