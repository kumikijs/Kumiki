import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
