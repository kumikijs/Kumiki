// The Int / Float methods of `docs/spec/stdlib.md` §2.2.7, and the one builtin
// call beside them.
//
// The spec used to document these as a `math.*` namespace (§2.4.4), which could
// not exist: the parser only reads a *capitalised* identifier as a call
// qualifier, so `math.abs(x)` parsed as a reference to a name called `math` and
// every one of the twelve names reported E0103. Four of them already existed as
// methods in §2.2.7, the seven below are methods now, and `random` is a builtin
// call.
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

/** `expr` in a reducer, on a program with a Text slot and a record slot too. */
function codesOnOtherReceivers(expr: string): string[] {
  const src = `type Row = { log: Text, size: Int }
slot label : Text  = "hello"
slot row   : Row   = {log: "l", size: 1}
slot dst   : Float = 0.0
reducer r on=ui.click(B) do= dst := ${expr}
tile B = button(text="b")
tile App = column(B, text(dst.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  return check(parse(lex(src))).map((e) => e.code);
}

/** `expr` assigned to a slot of type `slotType`, checked. */
function codesFor(slotType: string, expr: string): string[] {
  const init: Record<string, string> = { Int: "0", Float: "0.0", Text: '""' };
  const src = `slot i : Int   = 7
slot f : Float = 2.25
slot dst : ${slotType} = ${init[slotType]}
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
  { expr: "i.to-float", js: "(i)" },
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
      // What a missing lowering actually produces: the paren-less form falls
      // through to a bracket read — `(i)["floor"]`, `undefined` at run time —
      // and the paren form to a property call on a number, a TypeError. The
      // bracket shape is the one that occurs for nine of these rows, and an
      // assertion aimed at the other shape passed while the lowering was gone.
      expect(body, `fell through to a bracket read: ${body}`).not.toMatch(/\)\["/);
    });
  }

  // Both spellings mean the same thing for the argument-less ones, which is
  // what `FIELD_ACCESS_SHORTCUTS ⊆ KNOWN_METHODS` is for.
  for (const m of ["floor", "ceil", "round", "sqrt", "log", "exp", "abs", "neg"]) {
    it(`f.${m} and f.${m}() lower alike`, () => {
      expect(loweringOf(`f.${m}()`)).toBe(loweringOf(`f.${m}`));
    });
  }

  for (const m of ["to-float", "to-int"]) {
    it(`i.${m} and i.${m}() lower alike`, () => {
      expect(loweringOf(`i.${m}()`)).toBe(loweringOf(`i.${m}`));
    });
  }
});

// These are members of a number. Everything in `KNOWN_MEMBERS` used to be a
// member of every receiver the checker understands, so `someText.round` passed
// and lowered to `Math.round("hello")` — `NaN` into whatever it was assigned
// to, with `check`, `build`, `smoke` and a `noErrors` scenario all green. The
// control is `.cbrt`, which is in no table and was rejected all along.
describe("a numeric method on something that is not a number", () => {
  for (const m of ["floor", "ceil", "round", "sqrt", "log", "exp", "abs", "neg", "to-int"]) {
    it(`label.${m} is E0108, in both spellings`, () => {
      expect(codesOnOtherReceivers(`label.${m}`), m).toEqual(["E0108"]);
      expect(codesOnOtherReceivers(`label.${m}()`), m).toEqual(["E0108"]);
    });
  }

  it("reports the paren form on a record too, which used to be E0801", () => {
    expect(codesOnOtherReceivers("row.floor()")).toEqual(["E0108"]);
    expect(codesOnOtherReceivers("row.floor")).toEqual(["E0108"]);
  });

  it("leaves a record's own field alone, whatever it is called", () => {
    // `log` is an ordinary field name, and the gate must not take it for the
    // logarithm — the reason a receiver-blind member table is wrong.
    expect(codesOnOtherReceivers("row.size.to-float")).toEqual([]);
  });

  it("says nothing about a receiver whose type it does not know", () => {
    // The file's standing policy: a diagnostic is only for types understood
    // fully. A lambda-bound receiver keeps the dynamic pass-through.
    const src = `slot xs : List(Float) = [1.5]
slot dst : List(Float) = []
reducer r on=ui.click(B) do= dst := xs.map($1.sqrt)
tile B = button(text="b")
tile App = column(B, text(dst.size.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
  });
});

describe("what the checker knows about the result", () => {
  it("takes floor / ceil / round as Int", () => {
    for (const m of ["floor", "ceil", "round"]) {
      expect(codesFor("Int", `f.${m}`), m).toEqual([]);
      // Against a target the answer is wrong for. Without this the assertion
      // above passes either way — an undecidable result reports nothing too,
      // so "no diagnostic" cannot tell "Int" from "no idea".
      expect(codesFor("Text", `f.${m}`), m).toEqual(["E0201"]);
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

  // What that costs, measured rather than left to be discovered: with no result
  // type, a `pow` expression is not checked against its target at all, and the
  // receiver does not decide the answer either — `2.pow(-1)` is `0.5`.
  it("checks a pow expression against no target at all", () => {
    expect(codesFor("Text", "f.pow(2)")).toEqual([]);
    expect(codesFor("Int", "i.pow(0 - 1)")).toEqual([]);
  });
});

describe("a method written without the arguments it needs", () => {
  // `f.pow` parses as a field access, and the arity check lived only on the
  // method-call branch — so this reached codegen's bracket fallback and wrote
  // `undefined` into the slot, with `check` green.
  it("reports the bare spelling of a method that takes arguments", () => {
    expect(codesFor("Float", "f.pow")).toEqual(["E0213"]);
    expect(codesFor("Float", "f.min")).toEqual(["E0213"]);
  });

  it("still reports the empty call", () => {
    expect(codesFor("Float", "f.pow()")).toEqual(["E0213"]);
  });

  // The counterpart: a method that means something without arguments is not
  // caught by that rule, whatever `METHOD_MIN_ARGS` says about its call form.
  // `Option.get` is the one that matters — `m.get(k)` takes a key and `o.get`
  // takes nothing, and they are the same name.
  it("leaves a member that is legitimately argument-less alone", () => {
    const src = `slot o : Option(Int) = Some(1)
slot dst : Int = 0
reducer r on=ui.click(B) do= dst := o.get
tile B = button(text="b")
tile App = column(B, text(dst.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
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
