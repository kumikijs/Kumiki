import { describe, expect, it } from "vitest";
import { checkSource, summariesOf } from "./helpers/diagnostics.ts";
import { withButtonApp } from "./helpers/programs.ts";

describe("what .get-or answers", () => {
  it("assigning an unwrapped Option back to the Option slot is a mismatch", () => {
    expect(
      summariesOf(
        withButtonApp(`type S = {a: Text}
slot opt : Option(S) = None
slot fb : S = {a: ""}
reducer keep on=ui.click(B) do= opt := opt.get-or(fb)`),
      ),
    ).toEqual(["E0201 Expected Option(S) but got S"]);
  });

  it("assigning it to a slot of the unwrapped type stays clean", () => {
    expect(
      checkSource(
        withButtonApp(`type S = {a: Text}
slot opt : Option(S) = None
slot cur : S = {a: ""}
reducer keep on=ui.click(B) do= cur := opt.get-or(cur)`),
      ),
    ).toEqual([]);
  });

  it("a Result unwraps to its ok type, and assigning it back is a mismatch", () => {
    expect(
      summariesOf(
        withButtonApp(`slot res : Result(Int, Text) = Ok(1)
reducer keep on=ui.click(B) do= res := res.get-or(0)`),
      ),
    ).toEqual(["E0201 Expected Result(Int, Text) but got Int"]);
  });

  it("a Result's unwrapped value lands in a slot of the ok type", () => {
    expect(
      checkSource(
        withButtonApp(`slot res : Result(Int, Text) = Ok(1)
slot n : Int = 0
reducer keep on=ui.click(B) do= n := res.get-or(0)`),
      ),
    ).toEqual([]);
  });

  it("a Map answers its value type, not an Option of it", () => {
    expect(
      summariesOf(
        withButtonApp(`slot m : Map(Text, Int) = {}
slot o : Option(Int) = None
reducer keep on=ui.click(B) do= o := m.get-or("k", 0)`),
      ),
    ).toEqual(["E0201 Expected Option(Int) but got Int"]);
  });

  it("a Map lookup with a fallback lands in a slot of the value type", () => {
    expect(
      checkSource(
        withButtonApp(`slot m : Map(Text, Int) = {}
slot n : Int = 0
reducer keep on=ui.click(B) do= n := m.get-or("k", 0)`),
      ),
    ).toEqual([]);
  });

  it("an Int fallback still widens into a Float slot", () => {
    expect(
      checkSource(
        withButtonApp(`slot maybeN : Option(Int) = None
slot f : Float = 0.0
reducer keep on=ui.click(B) do= f := maybeN.get-or(0)`),
      ),
    ).toEqual([]);
  });
});

describe("the fallback carries the same type", () => {
  it("None as the fallback of an Option(record) is reported at the argument", () => {
    const errs = checkSource(
      withButtonApp(`type S = {a: Text}
slot opt : Option(S) = None
reducer keep on=ui.click(B) do= opt := opt.get-or(None)`),
    );
    expect(errs.map((e) => `${e.code} ${e.message}`)).toEqual([
      'E0201 Expected S but got variant "None"',
      "E0201 Expected Option(S) but got S",
    ]);
    const [atArg, atAssign] = errs;
    expect(atArg?.pos.line).toBe(atAssign?.pos.line);
    expect(atArg?.pos.col).toBeGreaterThan(atAssign?.pos.col ?? 0);
  });

  it("inside an emit argument it is still E0201, not the effect's own code", () => {
    expect(
      summariesOf(
        `slot m : Map(Text, Int) = {}
effect saveN cap=storage.write
             in=Int
             out=Result(Unit, Text)
             map-request={key: "n", value: $1}
reducer keep on=ui.click(B) do= emit saveN(m.get-or("k", "wrong"))
tile B = button(text="x")
tile App = column(B)
app A
    caps   = [storage.write]
    routes = {"/" -> App, "/404" -> App}
    init   = []`,
      ),
    ).toEqual(["E0201 Expected Int but got Text"]);
  });

  it("a fallback of the wrong primitive is reported", () => {
    expect(
      summariesOf(
        withButtonApp(`slot m : Map(Text, Int) = {}
slot n : Int = 0
reducer keep on=ui.click(B) do= n := m.get-or("k", "none")`),
      ),
    ).toEqual(["E0201 Expected Int but got Text"]);
  });
});

describe("what stays undecidable", () => {
  it("an argument count that does not fit the receiver decides no result type", () => {
    expect(
      summariesOf(
        withButtonApp(`slot opt : Option(Int) = None
slot n : Int = 0
reducer keep on=ui.click(B) do= n := opt.get-or("k", "none")`),
      ),
    ).toEqual([
      'E0213 Method ".get-or" on "Option" expects 1 argument(s) (default) but got 2 — ".get-or(key, default)" is the "Map" reading',
    ]);
    expect(
      summariesOf(
        withButtonApp(`slot m : Map(Text, Int) = {}
slot o : Option(Int) = None
reducer keep on=ui.click(B) do= o := m.get-or("k")`),
      ),
    ).toEqual([
      'E0213 Method ".get-or" on "Map" expects 2 argument(s) (key, default) but got 1 — ".get-or(default)" is the "Option" / "Result" reading',
    ]);
  });

  it("a None with no element type decides neither the fallback nor the result", () => {
    expect(
      checkSource(
        withButtonApp(`slot n : Int = 0
reducer keep on=ui.click(B) do= n := let o = None in o.get-or("not an Int")`),
      ),
    ).toEqual([]);
  });

  it("an untyped payload receiver says nothing", () => {
    expect(
      checkSource(
        withButtonApp(`slot n : Int = 0
reducer keep on=ui.click(B) do= n := $event.get-or("not an Int")`),
      ),
    ).toEqual([]);
  });

  it("an effect payload bind is a receiver like a slot: unwrapping one is the same pair", () => {
    expect(
      summariesOf(
        `type Session = {email: Text}
slot session : Option(Session) = None
effect loadSession cap=storage.read
                   in=Unit
                   out=Result(Option(Session), Text)
                   map-request={key: "session", decode: Decoder.Json(Session)}
reducer boot   on=app.start             do= emit loadSession()
reducer sessIn on=loadSession.ok($s, _) do= session := $s.get-or(None)
tile B = button(text="x")
tile App = column(B)
app A
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = []`,
      ),
    ).toEqual([
      'E0201 Expected Session but got variant "None"',
      "E0201 Expected Option(Session) but got Session",
    ]);
  });
});
