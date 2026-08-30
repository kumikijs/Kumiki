import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `.get-or(fallback)` unwraps: `Option(T)` and `Result(T, E)` answer `T`, and
// `Map(K, V).get-or(k, fallback)` answers `V` (stdlib.md §2.2.1 / §2.2.4 /
// §2.2.5). Nothing said so, so `opt := opt.get-or(x)` on an `Option(T)` slot
// passed `check` and left the slot holding a bare `T` — `is-some` false on a
// value that was there, and `match … with | Some(v)` taking the None arm.
//
// The fallback is checked against the same type, which is the report that
// names the mistake rather than its consequence.

const errsOf = (src: string) => check(parse(lex(src)));
const app = (defs: string): string =>
  `${defs}
tile B = button(text="x")
tile App = column(B)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const mismatches = (src: string) =>
  errsOf(src)
    .filter((e) => e.code === "E0201")
    .map((e) => e.message);

describe("what .get-or answers", () => {
  it("assigning an unwrapped Option back to the Option slot is a mismatch", () => {
    expect(
      mismatches(
        app(`type S = {a: Text}
slot opt : Option(S) = None
slot fb : S = {a: ""}
reducer keep on=ui.click(B) do= opt := opt.get-or(fb)`),
      ),
    ).toEqual(["Expected Option(S) but got S"]);
  });

  it("assigning it to a slot of the unwrapped type stays clean", () => {
    expect(
      errsOf(
        app(`type S = {a: Text}
slot opt : Option(S) = None
slot cur : S = {a: ""}
reducer keep on=ui.click(B) do= cur := opt.get-or(cur)`),
      ),
    ).toEqual([]);
  });

  it("a Result unwraps to its ok type, and assigning it back is a mismatch", () => {
    expect(
      mismatches(
        app(`slot res : Result(Int, Text) = Ok(1)
reducer keep on=ui.click(B) do= res := res.get-or(0)`),
      ),
    ).toEqual(["Expected Result(Int, Text) but got Int"]);
  });

  it("a Result's unwrapped value lands in a slot of the ok type", () => {
    expect(
      errsOf(
        app(`slot res : Result(Int, Text) = Ok(1)
slot n : Int = 0
reducer keep on=ui.click(B) do= n := res.get-or(0)`),
      ),
    ).toEqual([]);
  });

  it("a Map answers its value type, not an Option of it", () => {
    expect(
      mismatches(
        app(`slot m : Map(Text, Int) = {}
slot o : Option(Int) = None
reducer keep on=ui.click(B) do= o := m.get-or("k", 0)`),
      ),
    ).toEqual(["Expected Option(Int) but got Int"]);
  });

  it("a Map lookup with a fallback lands in a slot of the value type", () => {
    expect(
      errsOf(
        app(`slot m : Map(Text, Int) = {}
slot n : Int = 0
reducer keep on=ui.click(B) do= n := m.get-or("k", 0)`),
      ),
    ).toEqual([]);
  });

  it("an Int fallback still widens into a Float slot", () => {
    expect(
      errsOf(
        app(`slot maybeN : Option(Int) = None
slot f : Float = 0.0
reducer keep on=ui.click(B) do= f := maybeN.get-or(0)`),
      ),
    ).toEqual([]);
  });
});

describe("the fallback carries the same type", () => {
  it("None as the fallback of an Option(record) is reported at the argument", () => {
    const errs = errsOf(
      app(`type S = {a: Text}
slot opt : Option(S) = None
reducer keep on=ui.click(B) do= opt := opt.get-or(None)`),
    );
    // Two mistakes, not one report of two shapes: the fallback is not an `S`,
    // and what the call answers is not an `Option(S)`. The argument's position
    // is the inner one, so the two are distinguishable.
    expect(errs.map((e) => `${e.code} ${e.message}`)).toEqual([
      'E0201 Expected S but got variant "None"',
      "E0201 Expected Option(S) but got S",
    ]);
    const [atArg, atAssign] = errs;
    expect(atArg?.pos.col).toBeGreaterThan(atAssign?.pos.col ?? 0);
  });

  it("a fallback of the wrong primitive is reported", () => {
    expect(
      mismatches(
        app(`slot m : Map(Text, Int) = {}
slot n : Int = 0
reducer keep on=ui.click(B) do= n := m.get-or("k", "none")`),
      ),
    ).toEqual(["Expected Int but got Text"]);
  });
});

describe("what stays undecidable", () => {
  it("an argument count that does not fit the receiver says nothing", () => {
    // The runtime picks the Map reading or the Option one by counting
    // arguments, so neither call has a result type to check against.
    expect(
      mismatches(
        app(`slot opt : Option(Int) = None
slot n : Int = 0
reducer keep on=ui.click(B) do= n := opt.get-or("k", "none")`),
      ),
    ).toEqual([]);
    expect(
      mismatches(
        app(`slot m : Map(Text, Int) = {}
slot o : Option(Int) = None
reducer keep on=ui.click(B) do= o := m.get-or("k")`),
      ),
    ).toEqual([]);
  });

  it("a None with no element type decides neither the fallback nor the result", () => {
    expect(
      errsOf(
        app(`slot n : Int = 0
reducer keep on=ui.click(B) do= n := let o = None in o.get-or("not an Int")`),
      ),
    ).toEqual([]);
  });

  it("an untyped payload receiver says nothing", () => {
    expect(
      errsOf(
        app(`slot n : Int = 0
reducer keep on=ui.click(B) do= n := $event.get-or("not an Int")`),
      ),
    ).toEqual([]);
  });
});
