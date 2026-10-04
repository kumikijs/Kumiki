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

  // The application is checked for refinements its arguments put over a base
  // they cannot test, and that walk entered each application in a body with
  // its arguments substituted: `D40`'s body holds three `D39`s, so it walked
  // `D0` 3^40 times. Fourteen levels took seconds; forty would never finish.
  it("checks an application at forty levels that each apply the one below three times", () => {
    expect(diags(`${chain(40, 3, "T")}\nslot a : D40(Text) = "ku"`, "a := 5")).toEqual([
      "E0201 Expected D40(Text) but got Int",
    ]);
  });

  // The walk reported the refinement once per path to it, so the count of
  // copies was the count of walks: 3^12 here, which overflowed the stack.
  it("reports a refinement over the wrong base once, however many paths reach it", () => {
    expect(
      diags(`${chain(12, 3, "T where nonempty")}\nslot a : D12(Int) = 1`, "a := 2").filter((d) =>
        d.startsWith("E0804"),
      ),
    ).toEqual([
      'E0804 Refinement "nonempty" tests text but D12(Int) applies it over Int, so no value satisfies it',
    ]);
  });

  // Each application's argument is taken through the generics that hand it
  // straight back before the walk goes on, and the message still names the
  // base as the application gives it: a container keeps the argument as written.
  it("names the base a deep chain applies a refinement over, as before", () => {
    const LIST = `type L(T) = List(T)\ntype Q(T) = T where nonempty\n${chain(3, 3, "Q(T)")}`;
    expect(
      diags(`${LIST}\nslot a : D3(L(D3(Int))) = []`, "a := []").filter((d) =>
        d.startsWith("E0804"),
      ),
    ).toEqual([
      'E0804 Refinement "nonempty" tests text but D3(L(D3(Int))) applies it over List(D3(Int)), so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D3(Int) applies it over Int, so no value satisfies it',
    ]);
    const UNION = `type U(T) = A(T) | B\n${chain(3, 3, "T where one-of(1, 2)")}`;
    expect(
      diags(`${UNION}\nslot a : D3(U(Text)) = B`, "a := B").filter((d) => d.startsWith("E0804")),
    ).toEqual([
      'E0804 Refinement "one-of" tests text or a number but D3(U(Text)) applies it over A(Text) | B, so no value satisfies it',
    ]);
  });

  // `nominal` is looked through on the way to a base, so a generic nominal
  // hands its parameter back as an alias does, and a chain of them meets the
  // same way.
  it("reports a refinement once through a chain of generic nominals", () => {
    const NOMINAL = `type N(T) = nominal T where nonempty\n${chain(12, 3, "N(T)")}`;
    expect(
      diags(`${NOMINAL}\nslot a : D12(Int) = 1`, "a := 2").filter((d) => d.startsWith("E0804")),
    ).toEqual([
      'E0804 Refinement "nonempty" tests text but D12(Int) applies it over Int, so no value satisfies it',
    ]);
  });

  // A bottom that is a type of its own hands nothing back, so every argument
  // reaches `D0` distinct and the walk is still 3^k: kept shallow so it stays
  // fast. It pins the messages that walk gives, which sharing must not change.
  it("still checks a chain whose generics hand nothing back", () => {
    const RECORD = chain(5, 3, "{v: T where nonempty}");
    expect(
      diags(`${RECORD}\nslot a : D5(Int) = {v: 1}`, "a := a").filter((d) => d.startsWith("E0804")),
    ).toEqual([
      'E0804 Refinement "nonempty" tests text but D0(D0(D0(T))) applies it over {v: D0(?)}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D0(D0(T)) applies it over {v: ?}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D1(D1(D1(T))) applies it over {v: D0(D0(D1(?)))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D1(D1(T)) applies it over {v: D0(D0(?))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D2(D2(D2(T))) applies it over {v: D0(D0(D1(D1(D2(?)))))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D2(D2(T)) applies it over {v: D0(D0(D1(D1(?))))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D3(D3(D3(T))) applies it over {v: D0(D0(D1(D1(D2(D2(D3(?)))))))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D3(D3(T)) applies it over {v: D0(D0(D1(D1(D2(D2(?))))))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D4(D4(D4(T))) applies it over {v: D0(D0(D1(D1(D2(D2(D3(D3(D4(?)))))))))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D4(D4(T)) applies it over {v: D0(D0(D1(D1(D2(D2(D3(D3(?))))))))}, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but D5(Int) applies it over Int, so no value satisfies it',
    ]);
  });
});

// An application reports each refinement its arguments put over the wrong
// base once: paths that reach the same refinement say nothing new, and two
// refinements that read alike are still two.
describe("how many E0804s an application gets", () => {
  const e0804 = (decl: string) => diags(decl, `o := o`).filter((d) => d.startsWith("E0804"));

  it("reports two refinements that read alike twice", () => {
    expect(
      e0804(
        `type P(T) = {a: T where nonempty, b: T where nonempty}\nslot s : P(Int) = {a: 1, b: 1}`,
      ),
    ).toEqual([
      'E0804 Refinement "nonempty" tests text but P(Int) applies it over Int, so no value satisfies it',
      'E0804 Refinement "nonempty" tests text but P(Int) applies it over Int, so no value satisfies it',
    ]);
  });

  it("reports one refinement reached by two fields once, and a different one besides", () => {
    const BOTH = `type NE(T) = T where nonempty
type Pos(T) = T where positive
type Both(A, B) = {x: NE(A), y: Pos(B), z: NE(A)}
slot s : Both(Int, Text) = {x: 1, y: "a", z: 1}`;
    expect(e0804(BOTH)).toEqual([
      'E0804 Refinement "nonempty" tests text but Both(Int, Text) applies it over Int, so no value satisfies it',
      'E0804 Refinement "positive" tests a number but Both(Int, Text) applies it over Text, so no value satisfies it',
    ]);
  });

  // `Int()` is an application of a name nothing declares (E0117), which has no
  // base to judge; `Int` has one. Both orders report the `Int` field.
  it("tells an application with no arguments from the name it applies", () => {
    const O = `type P(T) = T where nonempty\ntype O(A, B) = {x: P(A), y: P(B)}`;
    const message =
      'E0804 Refinement "nonempty" tests text but O(Int, Int) applies it over Int, so no value satisfies it';
    expect(e0804(`${O}\nslot s : O(Int(), Int) = {x: 1, y: 1}`)).toEqual([message]);
    expect(e0804(`${O}\nslot s : O(Int, Int()) = {x: 1, y: 1}`)).toEqual([message]);
  });

  // Two arguments written apart reach the one refinement over the same base,
  // and that is one problem.
  it("reports one refinement reached through two parameters over one base once", () => {
    const O = `type P(T) = T where nonempty\ntype O(A, B) = {x: P(A), y: P(B)}`;
    expect(e0804(`${O}\nslot s : O(Int, Int) = {x: 1, y: 1}`)).toEqual([
      'E0804 Refinement "nonempty" tests text but O(Int, Int) applies it over Int, so no value satisfies it',
    ]);
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
