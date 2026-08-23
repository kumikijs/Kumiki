// The Int / Float methods of `docs/spec/stdlib.md` §2.2.7, and the one builtin
// call beside them.
//
// The spec used to document these as a `math.*` namespace (§2.4.4), which could
// not exist: the parser only reads a *capitalised* identifier as a call
// qualifier, so `math.abs(x)` parsed as a reference to a name called `math` and
// every one of the eleven functions reported E0103. Four of them already
// existed as methods in §2.2.7, and the rest are methods now.
//
// Two things can go wrong that `check` alone does not see. A method the checker
// knows and codegen does not falls through to `(recv).m(args)` — a JS property
// call on a number, which throws at runtime. And a result type that is wrong
// rather than absent turns a working program into a diagnostic.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** The generated body of `fn probe`, which is where the expression lands. */
function loweringOf(expr: string): string {
  // The receivers are fn parameters rather than slots: a `fn` that reads a slot
  // is E0305, and what is under test is the expression, not the scope.
  const src = `fn probe(i: Int, f: Float) -> Text = (${expr}).show
tile App = column(text(probe(7, 2.25)))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  const result = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (result.kind !== "ok") {
    throw new Error(`compile failed: ${result.errors.map((e) => e.code).join(", ")}`);
  }
  const body = result.js.split("\n").find((l) => l.includes("function probe"));
  if (body === undefined) throw new Error("no `function probe` in the generated module");
  return body;
}

/** `expr` assigned to a slot of type `slotType`, checked. */
function codesFor(slotType: string, expr: string): string[] {
  const src = `slot i : Int   = 7
slot f : Float = 2.25
slot dst : ${slotType} = ${slotType === "Int" ? "0" : "0.0"}
reducer r on=ui.click(B) do= dst := ${expr}
tile B = button(text="b")
tile App = column(B, text(dst.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  return check(parse(lex(src))).map((e) => e.code);
}

/**
 * Every method §2.2.7 lists, with the receiver it is written on and the JS it
 * lowers to. The whole set is here rather than only the new ones: what this
 * pins is that the section and the implementation agree, and a method removed
 * from either side should fail.
 */
const METHODS: { expr: string; js: string }[] = [
  { expr: "i.abs", js: "Math.abs" },
  { expr: "i.neg", js: "-(" },
  { expr: "i.min(3)", js: "Math.min" },
  { expr: "i.max(3)", js: "Math.max" },
  { expr: "i.clamp(0, 5)", js: "Math.min(Math.max" },
  { expr: "i.to-float", js: "(" },
  { expr: "f.to-int", js: "Math.trunc" },
  { expr: "f.floor", js: "Math.floor" },
  { expr: "f.ceil", js: "Math.ceil" },
  { expr: "f.round", js: "Math.round" },
  { expr: "f.sqrt", js: "Math.sqrt" },
  { expr: "f.log", js: "Math.log" },
  { expr: "f.exp", js: "Math.exp" },
  { expr: "f.pow(2)", js: "**" },
];

describe("the Int / Float methods the spec lists", () => {
  for (const { expr, js } of METHODS) {
    it(`${expr} lowers to ${js}`, () => {
      const body = loweringOf(expr);
      expect(body).toContain(js);
      // The generic fallback is `(recv).method(args)` — a property call on a
      // number, which is a TypeError the moment it runs.
      const method = expr.replace(/^[if]\./, "").replace(/\(.*$/, "");
      expect(body, `fell through to the fallback: ${body}`).not.toMatch(
        new RegExp(`\\)\\.${method.replace("-", "_")}\\(`),
      );
    });
  }

  // Both spellings mean the same thing for the argument-less ones, which is
  // what `FIELD_ACCESS_SHORTCUTS ⊆ KNOWN_METHODS` is for.
  for (const m of ["floor", "ceil", "round", "sqrt", "log", "exp"]) {
    it(`f.${m} and f.${m}() lower alike`, () => {
      expect(loweringOf(`f.${m}()`)).toBe(loweringOf(`f.${m}`));
    });
  }
});

describe("what the checker knows about the result", () => {
  it("takes floor / ceil / round as Int", () => {
    for (const m of ["floor", "ceil", "round"]) {
      expect(codesFor("Int", `f.${m}`), m).toEqual([]);
    }
  });

  it("takes sqrt / log / exp as Float, and says so when the target is Int", () => {
    for (const m of ["sqrt", "log", "exp"]) {
      expect(codesFor("Float", `f.${m}`), m).toEqual([]);
      expect(codesFor("Int", `f.${m}`), m).toEqual(["E0201"]);
    }
  });

  // `pow`'s result follows its receiver — `2.pow(3)` is an Int and `2.5.pow(2)`
  // is not — and METHOD_RESULT is for methods whose answer is fixed whatever
  // the receiver is. Guessing there would reject a working program, so it stays
  // undecidable and both targets are accepted.
  it("leaves pow undecided rather than guessing", () => {
    expect(codesFor("Int", "i.pow(2)")).toEqual([]);
    expect(codesFor("Float", "f.pow(2)")).toEqual([]);
  });
});

describe("random", () => {
  it("is a Float, and is callable wherever now is", () => {
    expect(codesFor("Float", "random()")).toEqual([]);
    expect(codesFor("Int", "random()")).toEqual(["E0201"]);
  });

  it("lowers to the platform's generator", () => {
    expect(loweringOf("random()")).toContain("Math.random()");
  });

  // Unlike `now`, which the checker also accepts as a bare reference, `random`
  // is only a call: a name that answers differently every time it is read is
  // worth the parentheses, and nothing in the spec writes it without them.
  it("is not a bare name", () => {
    expect(codesFor("Float", "random")).toEqual(["E0103"]);
  });
});
