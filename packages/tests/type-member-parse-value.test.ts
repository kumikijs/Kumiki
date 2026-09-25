// `T.parse(text)` is an `Option(T)` (stdlib §2.4.3), and what it converts the
// text into is decided by the base `T` unaliases to, not by the name it is
// written with. The lowering used to branch on the name — `Int`, `Float` and
// `Time` converted, and every other qualifier wrapped the raw string — so a
// nominal over `Int` parsed to a `Text`, and the arithmetic after it
// concatenated:
//
//   type Cents = nominal Int where positive
//   total := total + Cents.parse("12").get-or(0)      # 12 + "12" = "1212"
//
// `check` said `ok` and nothing threw: the defect is a value of the wrong kind,
// and only the state shows it. So every assertion here reads `shape.live`,
// never the DOM.

import { runScenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function freshRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

/** One reducer, dispatched by name, whose writes are what the test reads. */
function app(defs: string, body: string): string {
  return `${defs}
reducer go on=ui.click(Go)
    do= ${body}
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

async function stateAfterGo(source: string): Promise<Record<string, unknown>> {
  const shape = await loadSource(source);
  const report = await runScenario(shape, freshRoot(), {
    steps: [{ do: { dispatch: "go" }, expect: { noErrors: true } }],
  });
  expect(report.steps.flatMap((s) => s.failures)).toEqual([]);
  return shape.live ?? {};
}

describe("a nominal parses by the base it is declared over", () => {
  it("adds a parsed nominal Int as a number", async () => {
    const live = await stateAfterGo(
      app(
        `type Cents = nominal Int where positive\nslot total : Cents = 12`,
        `total := total + Cents.parse("12").get-or(0)`,
      ),
    );
    expect(live.total).toBe(24);
  });

  it("reads a nominal Float as a number", async () => {
    const live = await stateAfterGo(
      app(`type Ratio = nominal Float\nslot r : Option(Ratio) = None`, `r := Ratio.parse("0.25")`),
    );
    expect(live.r).toEqual({ _tag: "Some", _0: 0.25 });
  });

  it("reads a nominal Time as the millisecond instant a Time is", async () => {
    const live = await stateAfterGo(
      app(
        `type Due = nominal Time\nslot d : Option(Due) = None`,
        `d := Due.parse("2026-01-01T00:00:00Z")`,
      ),
    );
    expect(live.d).toEqual({ _tag: "Some", _0: Date.UTC(2026, 0, 1) });
  });

  it("keeps the string for a nominal over Text", async () => {
    const live = await stateAfterGo(
      app(`type Slug = nominal Text\nslot s : Option(Slug) = None`, `s := Slug.parse("a-b")`),
    );
    expect(live.s).toEqual({ _tag: "Some", _0: "a-b" });
  });

  it("answers None for a nominal Int given text that names no number", async () => {
    const live = await stateAfterGo(
      app(
        `type Cents = nominal Int where positive\nslot c : Option(Cents) = Some(1)`,
        `c := Cents.parse("twelve")`,
      ),
    );
    expect(live.c).toEqual({ _tag: "None" });
  });
});

describe("Bool.parse converts rather than answering the text", () => {
  // `Some("false")` was the answer, and a non-empty string is truthy, so every
  // `if` over the unwrapped value took the `true` branch.
  it("reads false as false and true as true", async () => {
    const live = await stateAfterGo(
      app(
        `slot f : Option(Bool) = None\nslot t : Option(Bool) = None`,
        `f := Bool.parse("false")\n        t := Bool.parse("true")`,
      ),
    );
    expect(live.f).toEqual({ _tag: "Some", _0: false });
    expect(live.t).toEqual({ _tag: "Some", _0: true });
  });

  it("answers None for text that is neither", async () => {
    const live = await stateAfterGo(
      app(`slot b : Option(Bool) = Some(true)`, `b := Bool.parse("yes")`),
    );
    expect(live.b).toEqual({ _tag: "None" });
  });
});

describe("the standard library's Duration and Bytes parse to their own representation", () => {
  it("reads a Duration as the millisecond number it is", async () => {
    // `.get-or(0).to-ms` style arithmetic is what the number is for; adding it
    // to a Duration is the same concatenation `Cents` suffered.
    const live = await stateAfterGo(
      app(
        `slot d : Duration = Duration.ms(100)`,
        `d := d + Duration.parse("500").get-or(Duration.ms(0))`,
      ),
    );
    expect(live.d).toBe(600);
  });

  it("reads Bytes as the UTF-8 bytes of the text", async () => {
    const live = await stateAfterGo(app(`slot b : Option(Bytes) = None`, `b := Bytes.parse("hi")`));
    const b = live.b as { _tag: string; _0: unknown };
    expect(b._tag).toBe("Some");
    expect(b._0).toBeInstanceOf(Uint8Array);
    expect([...(b._0 as Uint8Array)]).toEqual([104, 105]);
  });
});

describe("a parse reads through every alias and nominal on the way to the base", () => {
  it("reads a nominal over a nominal, and a plain alias, as their base", async () => {
    const live = await stateAfterGo(
      app(
        `type Cents = nominal Int
type Tally = nominal Cents
type Count = Int
type Flag = nominal Bool
slot t : Option(Tally) = None
slot c : Option(Count) = None
slot f : Option(Flag) = None`,
        `t := Tally.parse("4")\n        c := Count.parse("5")\n        f := Flag.parse("false")`,
      ),
    );
    expect(live.t).toEqual({ _tag: "Some", _0: 4 });
    expect(live.c).toEqual({ _tag: "Some", _0: 5 });
    expect(live.f).toEqual({ _tag: "Some", _0: false });
  });
});

describe("a parse never produces a value its type refuses", () => {
  // The refinement is part of the type: a `Cents` held in an `Option(Cents)`
  // never meets a slot-write guard, so a parse that let `-5` through handed
  // the program a `Cents` that is not one.
  it("answers None when the reading fails the nominal's refinement", async () => {
    const live = await stateAfterGo(
      app(
        `type Cents = nominal Int where positive
type Count = Cents
slot neg : Option(Cents) = Some(1)
slot pos : Option(Cents) = None
slot via : Option(Count) = Some(1)`,
        `neg := Cents.parse("-5")\n        pos := Cents.parse("5")\n        via := Count.parse("0")`,
      ),
    );
    expect(live.neg).toEqual({ _tag: "None" });
    expect(live.pos).toEqual({ _tag: "Some", _0: 5 });
    expect(live.via).toEqual({ _tag: "None" });
  });

  it("checks a refinement on a nominal Text too", async () => {
    const live = await stateAfterGo(
      app(
        `type Code = nominal Text where len-eq(3)
slot a : Option(Code) = None
slot b : Option(Code) = Some("xyz")`,
        `a := Code.parse("abc")\n        b := Code.parse("abcd")`,
      ),
    );
    expect(live.a).toEqual({ _tag: "Some", _0: "abc" });
    expect(live.b).toEqual({ _tag: "None" });
  });
});

describe("Int and Float read decimal text only", () => {
  const INTS: [string, unknown][] = [
    ["12", { _tag: "Some", _0: 12 }],
    ["+7", { _tag: "Some", _0: 7 }],
    ["-3", { _tag: "Some", _0: -3 }],
    ["0x10", { _tag: "None" }],
    ["0b101", { _tag: "None" }],
    ["1e3", { _tag: "None" }],
    [" 12 ", { _tag: "None" }],
    ["1.5", { _tag: "None" }],
    ["", { _tag: "None" }],
  ];
  const FLOATS: [string, unknown][] = [
    ["0.25", { _tag: "Some", _0: 0.25 }],
    ["-2.5", { _tag: "Some", _0: -2.5 }],
    ["3", { _tag: "Some", _0: 3 }],
    ["1e3", { _tag: "Some", _0: 1000 }],
    ["1.5E-1", { _tag: "Some", _0: 0.15 }],
    ["0x10", { _tag: "None" }],
    [" 1.5", { _tag: "None" }],
    [".5", { _tag: "None" }],
    ["1.", { _tag: "None" }],
    ["Infinity", { _tag: "None" }],
    ["1e400", { _tag: "None" }],
    ["", { _tag: "None" }],
  ];

  async function readAll(type: string, cases: [string, unknown][]) {
    const slots = cases.map((_, i) => `slot s${i} : Option(${type}) = None`).join("\n");
    const body = cases
      .map(([t], i) => `s${i} := ${type}.parse(${JSON.stringify(t)})`)
      .join("\n        ");
    const live = await stateAfterGo(app(slots, body));
    return cases.map(([t], i) => [t, live[`s${i}`]]);
  }

  it("reads an optional sign and digits as an Int, and nothing else", async () => {
    expect(await readAll("Int", INTS)).toEqual(INTS);
  });

  it("reads a sign, digits, a fraction and an exponent as a Float, and nothing else", async () => {
    expect(await readAll("Float", FLOATS)).toEqual(FLOATS);
  });

  // A `Duration` is an `Int` of milliseconds, so it reads as one: a fraction
  // is not a whole number of milliseconds.
  it("reads a Duration as an Int", async () => {
    const live = await stateAfterGo(
      app(
        `slot a : Option(Duration) = None\nslot b : Option(Duration) = Some(Duration.ms(1))`,
        `a := Duration.parse("250")\n        b := Duration.parse("1.5")`,
      ),
    );
    expect(live.a).toEqual({ _tag: "Some", _0: 250 });
    expect(live.b).toEqual({ _tag: "None" });
  });
});

describe("an empty text reads as None where the base is text", () => {
  it("answers None for Text, a nominal Text and Bytes", async () => {
    const live = await stateAfterGo(
      app(
        `type Slug = nominal Text
slot t : Option(Text) = Some("x")
slot s : Option(Slug) = Some("x")
slot b : Option(Bytes) = Some(Bytes.from-text("x"))`,
        `t := Text.parse("")\n        s := Slug.parse("")\n        b := Bytes.parse("")`,
      ),
    );
    expect(live.t).toEqual({ _tag: "None" });
    expect(live.s).toEqual({ _tag: "None" });
    expect(live.b).toEqual({ _tag: "None" });
  });
});
