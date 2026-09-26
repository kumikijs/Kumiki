import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `.get-or(fallback)` answers from its receiver's type argument: `Option(T)`
// and `Result(T, E)` answer `T`, and `Map(K, V).get-or(k, fallback)` answers
// `V` (stdlib.md §2.2.4 / §2.2.5 / §2.2.1). Nothing said so, so
// `opt := opt.get-or(x)` on an `Option(T)` slot passed `check` and left the
// slot holding a bare `T` — `is-some` and `is-none` both false on a value that
// was there, so a `when(is-some, …)` / `when(is-none, …)` pair rendered
// neither arm.
//
// The fallback is checked against the same type, which is the report that
// names the mistake rather than its consequence.
//
// Every expectation here is the whole diagnostic list rather than a filtered
// one: a stray extra report on a program this file calls clean is the thing
// worth catching. The argument-count cases have since gained the diagnostic
// this file anticipated — as an E0213, since the receiver deciding the count
// is what an arity mismatch is; `get-or-receiver-arity.test.ts` owns it, and
// what is pinned here is that it did not also make the result type decidable.

const errsOf = (src: string) => check(parse(lex(src)));
const app = (defs: string): string =>
  `${defs}
tile B = button(text="x")
tile App = column(B)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const diagnostics = (src: string) => errsOf(src).map((e) => `${e.code} ${e.message}`);

describe("what .get-or answers", () => {
  it("assigning an unwrapped Option back to the Option slot is a mismatch", () => {
    expect(
      diagnostics(
        app(`type S = {a: Text}
slot opt : Option(S) = None
slot fb : S = {a: ""}
reducer keep on=ui.click(B) do= opt := opt.get-or(fb)`),
      ),
    ).toEqual(["E0201 Expected Option(S) but got S"]);
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
      diagnostics(
        app(`slot res : Result(Int, Text) = Ok(1)
reducer keep on=ui.click(B) do= res := res.get-or(0)`),
      ),
    ).toEqual(["E0201 Expected Result(Int, Text) but got Int"]);
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
    // `.get` on the same receiver answers `Option(Int)` — the fallback is what
    // makes this one answer the value itself.
    expect(
      diagnostics(
        app(`slot m : Map(Text, Int) = {}
slot o : Option(Int) = None
reducer keep on=ui.click(B) do= o := m.get-or("k", 0)`),
      ),
    ).toEqual(["E0201 Expected Option(Int) but got Int"]);
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
    // and what the call answers is not an `Option(S)`.
    expect(errs.map((e) => `${e.code} ${e.message}`)).toEqual([
      'E0201 Expected S but got variant "None"',
      "E0201 Expected Option(S) but got S",
    ]);
    // The argument sits inside the assignment it is reported alongside: one
    // line, and further along it.
    const [atArg, atAssign] = errs;
    expect(atArg?.pos.line).toBe(atAssign?.pos.line);
    expect(atArg?.pos.col).toBeGreaterThan(atAssign?.pos.col ?? 0);
  });

  it("inside an emit argument it is still E0201, not the effect's own code", () => {
    // The fallback is wrong against the method's signature, which is a
    // different statement from "this is not what the effect declared in=".
    expect(
      diagnostics(
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
      diagnostics(
        app(`slot m : Map(Text, Int) = {}
slot n : Int = 0
reducer keep on=ui.click(B) do= n := m.get-or("k", "none")`),
      ),
    ).toEqual(["E0201 Expected Int but got Text"]);
  });
});

describe("what stays undecidable", () => {
  it("an argument count that does not fit the receiver decides no result type", () => {
    // The lowering picks the Map reading or the unwrapping one by counting
    // arguments, so neither call has a result type to check against here —
    // which is still true, and is what keeps a *wrong* result type from being
    // guessed. What has changed is that the mismatch no longer goes unsaid:
    // the count is reported as the arity error it is, so the call cannot
    // silently lower to the other reading. That report is the whole list —
    // no E0201 rides along on a result type nothing decided.
    expect(
      diagnostics(
        app(`slot opt : Option(Int) = None
slot n : Int = 0
reducer keep on=ui.click(B) do= n := opt.get-or("k", "none")`),
      ),
    ).toEqual([
      'E0213 Method ".get-or" on "Option" expects 1 argument(s) (default) but got 2 — ".get-or(key, default)" is the "Map" reading',
    ]);
    expect(
      diagnostics(
        app(`slot m : Map(Text, Int) = {}
slot o : Option(Int) = None
reducer keep on=ui.click(B) do= o := m.get-or("k")`),
      ),
    ).toEqual([
      'E0213 Method ".get-or" on "Map" expects 2 argument(s) (key, default) but got 1 — ".get-or(default)" is the "Option" / "Result" reading',
    ]);
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

  it("an effect payload bind is a receiver like a slot: unwrapping one is the same pair", () => {
    // The shape this defect was found in: an `Option` restored from storage,
    // unwrapped into the slot that declares it. `$s` has the Ok type of the
    // effect's `out=`, so the receiver decides the result exactly as an
    // `Option(Session)` slot would. `effect-payload-bind-type.test.ts` owns
    // the bind's type; this pins that `.get-or` reaches it.
    expect(
      diagnostics(
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
