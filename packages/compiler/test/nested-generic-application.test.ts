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

  it("still accepts the nominal it normalises to", () => {
    expect(
      diags(
        `slot n : NonEmpty(NonEmpty(Named(Short))) = "ku"\nslot m : Named(Short) = "ku"`,
        "n := m",
      ),
    ).toEqual([]);
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

  it("terminates on an alias that is its own argument", () => {
    expect(
      codes(`type NonEmpty(T) = T where nonempty\ntype A = NonEmpty(A)\nslot a : A = "a"`),
    ).toContain("E0009");
  });
});
