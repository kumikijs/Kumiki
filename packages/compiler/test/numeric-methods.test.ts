import { describe, expect, it } from "vitest";
import { codesOf } from "./helpers/diagnostics.ts";
import { fnLowering } from "./helpers/module.ts";

/** The generated body of `fn probe`, which is where the expression lands. */
function loweringOf(expr: string): string {
  // The receivers are fn parameters rather than slots: a `fn` that reads a slot
  // is E0305, and what is under test is the expression, not the scope.
  const src = `fn probe(i: Int, f: Float) -> Text = (${expr}).show
tile App = column(text(probe(7, 2.25)))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  return fnLowering(src);
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
  return codesOf(src);
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
  return codesOf(src);
}

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
      expect(body, `fell through to a bracket read: ${body}`).not.toMatch(/\)\["/);
    });
  }

  for (const m of ["floor", "ceil", "round", "sqrt", "log", "exp", "abs", "neg"]) {
    it(`f.${m} and f.${m}() lower alike`, () => {
      expect(loweringOf(`f.${m}()`)).toBe(loweringOf(`f.${m}`));
    });
  }

  for (const [m, recv] of [
    ["to-float", "i"],
    ["to-int", "f"],
  ] as const) {
    it(`${recv}.${m} and ${recv}.${m}() lower alike`, () => {
      expect(loweringOf(`${recv}.${m}()`)).toBe(loweringOf(`${recv}.${m}`));
    });
  }
});

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
    expect(codesOnOtherReceivers("row.size.to-float")).toEqual([]);
  });

  it("says nothing about a receiver whose type it does not know", () => {
    const src = `slot xs : List(Float) = []
slot dst : List(Float) = []
reducer r on=ui.click(B) do= dst := xs.fold([], $1.push($2)).map($1.sqrt)
tile B = button(text="b")
tile App = column(B, text(dst.length.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codesOf(src)).toEqual([]);
  });
});

describe("what the checker knows about the result", () => {
  it("takes floor / ceil / round as Int", () => {
    for (const m of ["floor", "ceil", "round"]) {
      expect(codesFor("Int", `f.${m}`), m).toEqual([]);
      expect(codesFor("Text", `f.${m}`), m).toEqual(["E0201"]);
    }
  });

  it("takes sqrt / log / exp as Float, and says so when the target is Int", () => {
    for (const m of ["sqrt", "log", "exp"]) {
      expect(codesFor("Float", `f.${m}`), m).toEqual([]);
      expect(codesFor("Int", `f.${m}`), m).toEqual(["E0201"]);
    }
  });

  it("leaves pow undecided rather than guessing", () => {
    expect(codesFor("Int", "i.pow(2)")).toEqual([]);
    expect(codesFor("Float", "f.pow(2)")).toEqual([]);
  });

  it("checks a pow expression against no target at all", () => {
    expect(codesFor("Text", "f.pow(2)")).toEqual([]);
    expect(codesFor("Int", "i.pow(0 - 1)")).toEqual([]);
  });
});

describe("a method written without the arguments it needs", () => {
  it("reports the bare spelling of a method that takes arguments", () => {
    expect(codesFor("Float", "f.pow")).toEqual(["E0213"]);
    expect(codesFor("Float", "f.min")).toEqual(["E0213"]);
  });

  it("still reports the empty call", () => {
    expect(codesFor("Float", "f.pow()")).toEqual(["E0213"]);
  });

  it("leaves a member that is legitimately argument-less alone", () => {
    const src = `slot o : Option(Int) = Some(1)
slot dst : Int = 0
reducer r on=ui.click(B) do= dst := o.get
tile B = button(text="b")
tile App = column(B, text(dst.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(codesOf(src)).toEqual([]);
  });
});

describe("random", () => {
  it("is a Float, and is callable wherever now is", () => {
    expect(codesFor("Float", "random()")).toEqual([]);
    expect(codesFor("Int", "random()")).toEqual(["E0201"]);
  });

  it("lowers to the platform's generator", () => {
    expect(loweringOf("random()")).toContain("_s.random()");
  });

  it("is not a bare name", () => {
    expect(codesFor("Float", "random")).toEqual(["E0103"]);
  });

  it("takes no arguments, and says so", () => {
    expect(codesFor("Float", "random(1, 6)")).toEqual(["E0213"]);
  });
});
