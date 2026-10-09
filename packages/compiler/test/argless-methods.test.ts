import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// Issue #7: docs/spec/stdlib.md §2.2 argument-less methods. Both call shapes must
// work — `recv.m` (FieldAccess, the spec-recommended shortcut) and `recv.m()`
// (MethodCall). Each is written on a receiver §2.2 lists it for: a member of
// one receiver is E0108 on another.
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

const compileOk = (src: string): string => {
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (r.kind !== "ok") throw new Error(`compile failed: ${JSON.stringify(r)}`);
  return r.js;
};

describe("argument-less stdlib methods (issue #7)", () => {
  it("the parenthesized form no longer trips E0801", () => {
    const body = ARGLESS.map(([m, v]) => `heading((${v}.${m}()).show)`).join(", ");
    const errs = check(parse(lex(appSrc(body))));
    expect(errs.filter((e) => e.code === "E0801")).toEqual([]);
  });

  it("the no-paren form lowers to the runtime helper, not a silent `undefined`", () => {
    const body = ARGLESS.map(([m, v]) => `heading((${v}.${m}).show)`).join(", ");
    const js = compileOk(appSrc(body));
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
    // None of the 12 may fall through to the record-field accessor `(base)["m"]`
    // (the old silent-`undefined` bug). Guards against a future forgotten case.
    for (const [m] of ARGLESS) expect(js, m).not.toContain(`["${m}"]`);
  });

  it("the parenthesized form lowers identically", () => {
    const body = ARGLESS.map(([m, v]) => `heading((${v}.${m}()).show)`).join(", ");
    const js = compileOk(appSrc(body));
    expect(js).toContain("_s.listHead(");
    expect(js).toContain("_s.toOption(");
    expect(js).toContain("Math.trunc(");
  });
});

// `t.parse-int` is `Int.parse(t)` and `t.parse-float` is `Float.parse(t)`
// (stdlib §2.2.6): every spelling of a reading — the method, `T.parse` on the
// base or on a type declared over it, and the reader of an `input` bound to
// one — lowers to the one runtime helper for its base, so no spelling carries
// a copy of the rule of its own.
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
    const js = compileOk(src);
    // Int.parse, Cents.parse, the bound `n`'s reader, and .parse-int.
    expect(calls(js, "parseIntOpt")).toBe(4);
    // Float.parse, Ratio.parse, the bound `x`'s reader, and .parse-float().
    expect(calls(js, "parseFloatOpt")).toBe(4);
    // The decimal-digit pattern is the helper's, and appears nowhere else.
    expect(js).not.toContain("[0-9]");
  });
});
