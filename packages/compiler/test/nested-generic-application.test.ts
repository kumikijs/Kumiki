// A generic applied inside itself — `NonEmpty(NonEmpty(Short))`, or reached
// again through another generic's argument — is a type like any other, and a
// write of the wrong type into it is E0201.
//
// Normalisation used to read the substituted argument under the guard of the
// body it was substituted into, so the inner application met its own name as a
// re-entry and the type normalised to nothing. With no type to compare
// against, every write was accepted: `a := 5` checked `ok` on a `Text` slot.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const HEAD = `type NonEmpty(T) = T where nonempty
type Short       = Text where len-lt(7)
type Named(T)    = nominal NonEmpty(T) where len-gt(1)
type Other       = nominal Text
slot o : Other = "x"
`;
const TAIL = `tile B = button(text="b", onClick=w)
tile App = column(B)
app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const diags = (decl: string, write: string) =>
  check(parse(lex(`${HEAD}${decl}\nreducer w on=ui.click(B) do= ${write}\n${TAIL}`))).map(
    (e) => `${e.code} ${e.message}`,
  );

describe("a generic applied inside itself", () => {
  it("refuses an Int written into NonEmpty(NonEmpty(Short))", () => {
    expect(diags(`slot a : NonEmpty(NonEmpty(Short)) = "ku"`, "a := 5")).toEqual([
      "E0201 Expected NonEmpty(NonEmpty(Short)) but got Int",
    ]);
  });

  it("refuses it three levels deep", () => {
    expect(diags(`slot a : NonEmpty(NonEmpty(NonEmpty(Text))) = "ku"`, "a := 5")).toEqual([
      "E0201 Expected NonEmpty(NonEmpty(NonEmpty(Text))) but got Int",
    ]);
  });

  it("accepts a Text written into it", () => {
    expect(diags(`slot a : NonEmpty(NonEmpty(Short)) = "ku"`, `a := "ok"`)).toEqual([]);
  });

  // `Named`'s body applies `NonEmpty` again, so reaching it through the outer
  // `NonEmpty`'s argument re-entered the name the same way.
  it("keeps the nominal of a generic reached through the argument", () => {
    expect(diags(`slot n : NonEmpty(Named(Short)) = "ku"`, "n := o")).toEqual([
      "E0201 Expected NonEmpty(Named(Short)) but got Other",
    ]);
    expect(diags(`slot n : NonEmpty(NonEmpty(Named(Short))) = "ku"`, "n := o")).toEqual([
      "E0201 Expected NonEmpty(NonEmpty(Named(Short))) but got Other",
    ]);
  });

  // A generic that forwards its parameter into another application hands the
  // argument on again, and it is read where it was first written — not under
  // the guard of the body that forwarded it.
  it("refuses a different nominal through a generic applied inside itself", () => {
    expect(diags(`slot n : Named(Named(Short)) = "ku"`, "n := o")).toEqual([
      "E0201 Expected Named(Named(Short)) but got Other",
    ]);
  });

  it("refuses an Int through a nominal generic applied inside itself", () => {
    expect(diags(`slot n : Named(Named(Short)) = "ku"`, "n := 5")).toEqual([
      "E0201 Expected Named(Named(Short)) but got Int",
    ]);
  });

  it("refuses an Int through a generic that forwards its parameter", () => {
    expect(
      diags(`type Outer(T) = NonEmpty(T)\nslot n : Outer(Outer(Text)) = "ku"`, "n := 5"),
    ).toEqual(["E0201 Expected Outer(Outer(Text)) but got Int"]);
  });

  it("still accepts the nominal it normalises to", () => {
    expect(
      diags(
        `slot n : NonEmpty(NonEmpty(Named(Short))) = "ku"\nslot m : Named(Short) = "ku"`,
        "n := m",
      ),
    ).toEqual([]);
  });
});

describe("where the nested type is reached from", () => {
  it("checks the elements of a List of it", () => {
    expect(diags(`slot n : List(NonEmpty(NonEmpty(Short))) = []`, "n := [5]")).toEqual([
      "E0201 Expected NonEmpty(NonEmpty(Short)) but got Int",
    ]);
  });

  it("checks a fn's return value against it", () => {
    expect(diags(`fn bad() -> NonEmpty(NonEmpty(Short)) = 5`, "()")).toEqual([
      "E0201 Expected NonEmpty(NonEmpty(Short)) but got Int",
    ]);
  });

  it("checks a fn's argument against it", () => {
    expect(
      diags(
        `fn keep(s: NonEmpty(NonEmpty(Short))) -> Text = s\nslot t : Text = ""`,
        "t := keep(5)",
      ),
    ).toEqual(["E0201 Expected NonEmpty(NonEmpty(Short)) but got Int"]);
  });
});

describe("a match on a union reached through a generic applied inside itself", () => {
  const UNION = `type Alias(T) = T
type LR(T) = L(T) | R
slot u : Alias(Alias(LR(Int))) = R
slot t : Text = ""`;

  it("types the payload a pattern binds", () => {
    expect(diags(UNION, `t := match u with | L(x) -> x | R -> ""`)).toEqual([
      "E0201 Expected Text but got Int",
    ]);
  });

  it("accepts a match that fits it", () => {
    expect(diags(UNION, `t := match u with | L(x) -> "l" | R -> ""`)).toEqual([]);
  });

  it("refuses a variant the union does not have", () => {
    expect(diags(UNION, `t := match u with | L(x) -> "l" | Q -> ""`)).toEqual([
      'E0209 Variant "Q" is not a member of scrutinee type "Alias(Alias(LR(Int)))"',
    ]);
  });
});

// Each level applies the one below more than once. Normalising by expanding
// every body walks the bottom definition 2^k (or 3^k) times, which exhausted
// the stack at a dozen definitions; a generic that hands its parameter back is
// now taken in one step.
describe("a chain of definitions that each apply the one below repeatedly", () => {
  const chain = (levels: number, times: number, bottom: string) => {
    const lines = [`type D0(T) = ${bottom}`];
    for (let i = 1; i <= levels; i += 1) {
      let body = "T";
      for (let n = 0; n < times; n += 1) body = `D${i - 1}(${body})`;
      lines.push(`type D${i}(T) = ${body}`);
    }
    return lines.join("\n");
  };

  it("checks a write when each level applies the one below twice", () => {
    expect(diags(`${chain(12, 2, "T")}\nslot a : D12(Text) = "ku"`, "a := 5")).toEqual([
      "E0201 Expected D12(Text) but got Int",
    ]);
  });

  it("checks a write when each level applies the one below three times", () => {
    expect(diags(`${chain(8, 3, "T")}\nslot a : D8(Text) = "ku"`, "a := 5")).toEqual([
      "E0201 Expected D8(Text) but got Int",
    ]);
  });

  it("still reports the refinement it cannot lower at fourteen levels", () => {
    expect(
      diags(`${chain(14, 2, "T where nonempty")}\nslot a : D14(Text) = "ku"`, `a := "ok"`).map(
        (d) => d.slice(0, 5),
      ),
    ).toEqual(["E0803"]);
  });
});

describe("a generic nominal applied inside itself", () => {
  const NOMINAL = `type Tag(T) = nominal T
type Cents  = nominal Int
type Yen    = nominal Int
slot c : Cents = 1
slot y : Yen = 1
slot b : Bool = false
slot n : Tag(Tag(Cents)) = 1`;

  // `Tag(Tag(Cents))` is declared as a `Tag` of a `Tag` of a `Cents`, so it
  // is a `Cents` — the same way `Tag(Cents)` is.
  it("is accepted where the nominal at the bottom is required", () => {
    expect(diags(NOMINAL, "c := n")).toEqual([]);
  });

  it("compares with the nominal at the bottom", () => {
    expect(diags(NOMINAL, "b := n == c")).toEqual([]);
  });

  it("is still refused where a different nominal is required", () => {
    expect(diags(NOMINAL, "y := n")).toEqual(["E0201 Expected Yen but got Tag(Tag(Cents))"]);
  });

  // `Wrap` forwards its parameter into `Tag`, so the inner `Wrap` is
  // substituted twice before the chain reads it — and is read where it was
  // written, not under the guard of the `Wrap` that forwarded it.
  it("keeps the whole chain through a generic that forwards into it", () => {
    const WRAP = `${NOMINAL}\ntype Wrap(T) = Tag(T)\nslot w : Wrap(Wrap(Cents)) = 1`;
    expect(diags(WRAP, "c := w")).toEqual([]);
    expect(diags(WRAP, "y := w")).toEqual(["E0201 Expected Yen but got Wrap(Wrap(Cents))"]);
  });
});

describe("a generic that closes on itself", () => {
  const APP = `tile App = column(text("a"))
app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
  const codes = (src: string) => check(parse(lex(`${src}\n${APP}`))).map((e) => e.code);

  // The re-entry here is through the body, not an argument, so the guard
  // still stops it — and E0009 is still what reports it.
  it("terminates on a generic that forwards to itself", () => {
    expect(codes(`type Loop(T) = Loop(T) where nonempty\nslot l : Loop(Text) = "a"`)).toContain(
      "E0009",
    );
  });

  // `D1` hands its parameter back through `D0` twice, so `A` is its own
  // argument here too.
  it("reports an alias that is its own argument through a doubled generic", () => {
    expect(
      codes(`type D0(T) = T\ntype D1(T) = D0(D0(T))\ntype A = D1(A)\nslot a : A = "a"`),
    ).toContain("E0009");
  });

  it("terminates on an alias that is its own argument", () => {
    expect(
      codes(`type NonEmpty(T) = T where nonempty\ntype A = NonEmpty(A)\nslot a : A = "a"`),
    ).toContain("E0009");
  });
});
