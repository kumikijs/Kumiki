// `inferType` existed but nothing ever compared an inferred type against a
// declared one, so `slot n : Int = "hello"` was `ok` and every promise in
// forms.md §5.6 ("You cannot put a string into `slot age : Int`") was empty.
// These drive the assignability relation and every site that now applies it.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `tile B = button(text="b")
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);
/** Definitions plus the minimum an app needs, so `check` sees a whole program. */
const prog = (defs: string) => codes(`${defs}\n${TAIL}`);
/** `defs` plus a reducer whose body is `body`. */
const inReducer = (defs: string, body: string) =>
  prog(`${defs}\nreducer r on=ui.click(B) do= ${body}`);

/**
 * `kind` is the machine-readable half of a diagnostic and the half nothing else
 * guards: `spec-drift` compares codes only, and `spec-index` compares the two
 * documents against each other rather than against the implementation. So a
 * rename here would ship silently and break every consumer switching on it —
 * `kumiki fix`'s skip reasons, the MCP surface, the debug skill's table.
 */
describe("the code ⇆ kind pairing of every diagnostic this adds", () => {
  const PAIRS: [string, string, string][] = [
    ["E0117", "undef-type", `slot v : Nope = 1`],
    ["E0201", "type-mismatch", `slot n : Int = "x"`],
    ["E0213", "call-arity-mismatch", `tile Row in=Text = box(text($1))\ntile H = Row()`],
    ["E0214", "missing-record-field", `type P = {a: Int, b: Int}\nslot p : P = {a: 1}`],
    ["E0215", "unknown-record-field", `type P = {a: Int}\nslot p : P = {a: 1, z: 2}`],
    ["E0216", "unknown-variant", `type S = Idle | Busy\nslot s : S = Zork`],
    ["E0217", "int-literal-precision", `slot n : Int = 9007199254740993`],
  ];

  for (const [code, kind, src] of PAIRS) {
    it(`emits ${code} as "${kind}"`, () => {
      const found = check(parse(lex(`${src}\n${TAIL}`))).filter((e) => e.code === code);
      expect(found.length, `no ${code} from this program`).toBeGreaterThan(0);
      expect(found[0]?.kind).toBe(kind);
    });
  }

  it("emits E0202 as emit-arg-type-mismatch", () => {
    const src = `effect save cap=storage.write in=Text out=Result(Unit, Text)
reducer r on=ui.click(B) do= emit save(1)
tile B = button(text="b")
tile App = column(B)
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
`;
    const found = check(parse(lex(src))).filter((e) => e.code === "E0202");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.kind).toBe("emit-arg-type-mismatch");
  });
});

describe("assignability — prims", () => {
  it("reports a Text literal in an Int slot", () => {
    expect(check(parse(lex(`slot n : Int = "hello"\n${TAIL}`)))).toEqual([
      {
        code: "E0201",
        kind: "type-mismatch",
        message: "Expected Int but got Text",
        pos: { line: 1, col: 16 },
      },
    ]);
  });

  it("reports an Int literal in a Text slot", () => {
    expect(prog(`slot t : Text = 1`)).toEqual(["E0201"]);
  });

  it("reports a Bool literal in a Text slot", () => {
    expect(prog(`slot t : Text = true`)).toEqual(["E0201"]);
  });

  it("widens Int to Float", () => {
    expect(prog(`slot f : Float = 0`)).toEqual([]);
  });

  it("does not narrow Float to Int", () => {
    expect(prog(`slot n : Int = 0.5`)).toEqual(["E0201"]);
  });

  it("accepts a Float literal in a Float slot", () => {
    expect(prog(`slot f : Float = 0.5`)).toEqual([]);
  });

  it("accepts matching prims", () => {
    expect(prog(`slot n : Int = 1\nslot t : Text = "a"\nslot b : Bool = false`)).toEqual([]);
  });
});

describe("assignability — nominal, refinement and aliases", () => {
  it("accepts the underlying prim through a nominal wrapper", () => {
    expect(prog(`type N = nominal Int where between(0, 999)\nslot c : N = 0`)).toEqual([]);
  });

  it("reports the wrong prim through a nominal wrapper", () => {
    expect(prog(`type N = nominal Int where between(0, 999)\nslot c : N = "0"`)).toEqual(["E0201"]);
  });

  it("follows an alias chain", () => {
    expect(prog(`type A = Int\ntype B = A\nslot n : B = "x"`)).toEqual(["E0201"]);
  });

  it("accepts anything for a type name that resolves to nothing", () => {
    // The name itself is reported (E0117); the value is not double-reported.
    expect(prog(`slot v : NoSuchType = 1`)).toEqual(["E0117"]);
  });
});

/**
 * Two `nominal` definitions over one base used to accept each other, so
 * `PostId := UserId` compiled — which is the one mistake `nominal` exists to
 * catch, and the opposite of what language.md §1.3.5 tells a reader.
 *
 * The rule is stated in one line and the cases below are it: two nominals
 * declared under different names reject each other, a nominal and its base
 * accept each other both ways, and only a named `type` definition confers the
 * identity.
 */
describe("assignability — a nominal type is distinct from every other one", () => {
  const MONEY = `type Cents = nominal Int where positive
type Yen   = nominal Int where positive
slot c : Cents = 1
slot y : Yen   = 2
slot n : Int   = 3`;

  it("reports one nominal assigned to another over the same base", () => {
    const errs = check(parse(lex(`${MONEY}\nreducer r on=ui.click(B) do= c := y\n${TAIL}`)));
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    // The names as written, not the base they share — an "Expected Int but got
    // Int" here would read as a compiler bug rather than as the mistake it is.
    expect(errs[0]?.message).toBe("Expected Cents but got Yen");
  });

  it("accepts a base literal in a nominal slot", () => {
    expect(prog(MONEY)).toEqual([]);
  });

  it("accepts the base in a nominal position and the nominal in a base position", () => {
    expect(inReducer(MONEY, `c := n`)).toEqual([]);
    expect(inReducer(MONEY, `n := c`)).toEqual([]);
  });

  it("accepts arithmetic on a nominal, which yields its base", () => {
    expect(inReducer(MONEY, `c := c + 1`)).toEqual([]);
  });

  it("still accepts a value the refinement rejects", () => {
    // The refinement is a runtime check (forms.md §5.6). This rule is about
    // which type a value has, not about whether the value is in range.
    expect(prog(`slot e : Email = "not-an-email"`)).toEqual([]);
  });

  it("treats an alias to a nominal as the same type", () => {
    const src = `type Cents = nominal Int where positive
type Money = Cents
type Kept  = Cents where positive
slot c : Cents = 1
slot m : Money = 2
slot k : Kept  = 3`;
    expect(prog(src)).toEqual([]);
    expect(inReducer(src, `m := c`)).toEqual([]);
    expect(inReducer(src, `c := m`)).toEqual([]);
    // A refinement on the way to the nominal does not hide it either.
    expect(inReducer(src, `k := c`)).toEqual([]);
    expect(
      inReducer(`${src}\ntype Yen = nominal Int where positive\nslot y : Yen = 4`, `k := y`),
    ).toEqual(["E0201"]);
  });

  it("terminates on an alias cycle", () => {
    // The identity walk runs before `unaliasType` and follows the same `TypeRef`
    // chain, so it needs its own guard: without one this never returns and
    // `check` hangs instead of reporting the cycle.
    expect(prog(`type A = B\ntype B = A\nslot x : A = 1`)).toEqual([]);
  });

  it("takes no identity from a nominal written inline at a use site", () => {
    // There is no definition to name, so there is nothing to tell it apart
    // from any other nominal over Int.
    const src = `type Yen = nominal Int where positive
slot y : Yen = 1
slot x : nominal Int = 2`;
    expect(inReducer(src, `x := y`)).toEqual([]);
  });

  it("reports one standard-library nominal assigned to another", () => {
    const src = `slot u : Url   = "https://example.com"
slot e : Email = "a@example.com"`;
    const errs = check(parse(lex(`${src}\nreducer r on=ui.click(B) do= e := u\n${TAIL}`)));
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe("Expected Email but got Url");
  });

  it("compares the arguments of a generic nominal, which shares its name", () => {
    const src = `type Box(T) = nominal List(T)
slot bi : Box(Int)  = [1]
slot bt : Box(Text) = ["a"]`;
    expect(prog(src)).toEqual([]);
    expect(inReducer(src, `bi := bt`)).toEqual(["E0201"]);
    expect(inReducer(src, `bi := bi`)).toEqual([]);
  });

  it("reports a nominal element inside a container", () => {
    const src = `${MONEY}\nslot l : List(Cents) = []`;
    expect(inReducer(src, `l := [y]`)).toEqual(["E0201"]);
    expect(inReducer(src, `l := [c]`)).toEqual([]);
  });

  it("reports a nominal in every position that has a declared type", () => {
    const POSITIONS = `type Cents = nominal Int where positive
type Yen   = nominal Int where positive
type Wallet = {balance: Cents}
slot y : Yen = 1
slot w : Wallet = {balance: 0}
fn add(a: Cents) -> Cents = a
effect save cap=storage.write in=Cents out=Result(Unit, Text)
tile Amount in=Cents = box(text($1.show))`;
    const app = `tile B = button(text="b")
tile App = column(B)
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
`;
    const withBody = (body: string) =>
      codes(`${POSITIONS}\nreducer r on=ui.click(B) do= ${body}\n${app}`);

    expect(withBody(`w.balance := y`)).toEqual(["E0201"]);
    expect(withBody(`w.balance := add(y)`)).toEqual(["E0201"]);
    expect(withBody(`emit save(y)`)).toEqual(["E0202"]);
    expect(codes(`${POSITIONS}\ntile Home = Amount(y)\n${app}`)).toEqual(["E0201"]);
    expect(codes(`${POSITIONS}\nfn wrong(a: Yen) -> Cents = a\n${app}`)).toEqual(["E0201"]);
  });

  it("stays silent when either side is undecidable", () => {
    // `Q` is not a type, so `q` has none, and a nominal identity nothing can
    // resolve must not become a mismatch on top of the undefined-name report.
    expect(prog(`type Cents = nominal Int where positive\nslot q : Q = 1`)).toEqual(["E0117"]);
    expect(
      inReducer(
        `type PostId = nominal Text where uuid
type UserId = nominal Text where uuid
slot p : PostId = "a"`,
        `p := UserId.fresh()`,
      ),
    ).toEqual([]);
  });

  it("does not reach the comparison operators", () => {
    // `==` is defined on every type and ordering asks `orderingFamily`, not
    // this relation. Both nominals reduce to Int there, so neither is
    // reported — pinned so that changing it is a decision rather than a
    // side effect of this rule.
    expect(inReducer(MONEY, `n := if c == y then 1 else 2`)).toEqual([]);
    expect(inReducer(MONEY, `n := if c < y then 1 else 2`)).toEqual([]);
  });
});

describe("assignability — containers", () => {
  it("reports the mismatched element of a list literal, at the element", () => {
    const errs = check(parse(lex(`slot l : List(Int) = [1, "a", true]\n${TAIL}`)));
    expect(errs.map((e) => e.code)).toEqual(["E0201", "E0201"]);
    expect(errs[0]?.pos).toEqual({ line: 1, col: 26 });
    expect(errs[1]?.pos).toEqual({ line: 1, col: 31 });
  });

  it("accepts a homogeneous list literal", () => {
    expect(prog(`slot l : List(Int) = [1, 2, 3]`)).toEqual([]);
  });

  it("accepts an empty list literal for any element type", () => {
    expect(prog(`slot l : List(Text) = []`)).toEqual([]);
  });

  it("checks Map keys and values separately", () => {
    expect(prog(`slot m : Map(Text, Int) = {"a": 1, "b": "no"}`)).toEqual(["E0201"]);
    expect(prog(`slot m : Map(Text, Int) = {1: 1}`)).toEqual(["E0201"]);
  });

  it("accepts an empty map literal", () => {
    expect(prog(`slot m : Map(Text, Int) = {}`)).toEqual([]);
  });

  it("reports a scalar where a container is declared", () => {
    expect(prog(`slot l : List(Int) = 1`)).toEqual(["E0201"]);
  });

  it("does not descend into an element whose type is an unresolved type parameter", () => {
    expect(prog(`type Box(T) = {v: List(T)}\nslot b : Box(Int) = {v: [1, 2]}`)).toEqual([]);
  });
});

describe("assignability — Option and Result", () => {
  it("reports a bare value where Option is declared", () => {
    expect(prog(`slot o : Option(Int) = 5`)).toEqual(["E0201"]);
  });

  it("accepts None", () => {
    expect(prog(`slot o : Option(Int) = None`)).toEqual([]);
  });

  it("accepts Some of the right type", () => {
    expect(prog(`slot o : Option(Int) = Some(5)`)).toEqual([]);
  });

  it("reports Some of the wrong type", () => {
    expect(prog(`slot o : Option(Int) = Some("5")`)).toEqual(["E0201"]);
  });

  it("checks Ok against the success argument and Err against the error argument", () => {
    expect(prog(`slot r : Result(Int, Text) = Ok(1)`)).toEqual([]);
    expect(prog(`slot r : Result(Int, Text) = Err("boom")`)).toEqual([]);
    expect(prog(`slot r : Result(Int, Text) = Ok("1")`)).toEqual(["E0201"]);
    expect(prog(`slot r : Result(Int, Text) = Err(1)`)).toEqual(["E0201"]);
  });
});

describe("assignability — records", () => {
  const P = `type P = {id: Int, name: Text, age: Int}`;

  it("reports every mistyped field", () => {
    expect(prog(`${P}\nslot p : P = {id: 1, name: 2, age: "x"}`)).toEqual(["E0201", "E0201"]);
  });

  it("reports each missing field", () => {
    expect(prog(`${P}\nslot q : P = {id: 1}`)).toEqual(["E0214", "E0214"]);
  });

  it("reports an undeclared field", () => {
    expect(prog(`${P}\nslot r : P = {id: 1, name: "n", age: 3, extra: true}`)).toEqual(["E0215"]);
  });

  it("accepts a complete, correctly typed record", () => {
    expect(prog(`${P}\nslot p : P = {id: 1, name: "n", age: 3}`)).toEqual([]);
  });

  it("checks a nested record field", () => {
    expect(
      prog(`type Inner = {n: Int}\ntype Outer = {i: Inner}\nslot o : Outer = {i: {n: "x"}}`),
    ).toEqual(["E0201"]);
  });

  it("reports a record literal where a prim is declared", () => {
    expect(prog(`slot n : Int = {a: 1}`)).toEqual(["E0201"]);
  });
});

describe("assignability — unions", () => {
  const S = `type S = Idle | Busy(Int)`;

  it("accepts a declared tag", () => {
    expect(prog(`${S}\nslot s : S = Idle`)).toEqual([]);
  });

  it("reports an undeclared tag", () => {
    expect(prog(`${S}\nslot s : S = Zork`)).toEqual(["E0216"]);
  });

  it("reports a payload arity mismatch", () => {
    expect(prog(`${S}\nslot s : S = Busy`)).toEqual(["E0213"]);
    expect(prog(`${S}\nslot s : S = Idle(1)`)).toEqual(["E0213"]);
  });

  it("checks the payload type", () => {
    expect(prog(`${S}\nslot s : S = Busy("x")`)).toEqual(["E0201"]);
    expect(prog(`${S}\nslot s : S = Busy(1)`)).toEqual([]);
  });

  it("reports a tag assigned to a slot in a reducer", () => {
    expect(inReducer(`${S}\nslot s : S = Idle`, `s := Zork`)).toEqual(["E0216"]);
  });
});

describe("slot assignment", () => {
  it("reports a Text rhs for an Int slot", () => {
    expect(inReducer(`slot n : Int = 0`, `n := "not a number"`)).toEqual(["E0201"]);
  });

  it("checks through a record field path", () => {
    expect(inReducer(`type P = {id: Int}\nslot p : P = {id: 1}`, `p.id := "x"`)).toEqual(["E0201"]);
  });

  it("checks through a list index path", () => {
    expect(inReducer(`slot l : List(Int) = []`, `l[0] := "x"`)).toEqual(["E0201"]);
  });

  it("checks through a map index path", () => {
    expect(inReducer(`slot m : Map(Text, Int) = {}`, `m["k"] := "x"`)).toEqual(["E0201"]);
  });

  it("accepts a correctly typed assignment", () => {
    expect(inReducer(`slot n : Int = 0`, `n := 1`)).toEqual([]);
  });
});

describe("fn application", () => {
  const F = `fn double(x: Int) -> Int = x * 2`;

  it("reports a Text argument for an Int parameter", () => {
    expect(inReducer(`slot n : Int = 0\n${F}`, `n := double("hello")`)).toEqual(["E0201"]);
  });

  it("accepts a correctly typed argument", () => {
    expect(inReducer(`slot n : Int = 0\n${F}`, `n := double(n)`)).toEqual([]);
  });

  it("reports a return type the body cannot produce", () => {
    expect(prog(`fn label(x: Int) -> Text = x`)).toEqual(["E0201"]);
  });

  it("accepts a body that matches the return type", () => {
    expect(prog(`fn label(x: Int) -> Text = x.show`)).toEqual([]);
  });

  it("still reports arity separately from types", () => {
    expect(inReducer(`slot n : Int = 0\n${F}`, `n := double()`)).toEqual(["E0213"]);
  });
});

describe("emit", () => {
  const E = `effect save cap=storage.write in=Text out=Result(Unit, Text)`;
  const caps = `tile B = button(text="b")
tile App = column(B)
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
`;
  const withEffect = (body: string) =>
    check(parse(lex(`${E}\nreducer r on=ui.click(B) do= ${body}\n${caps}`))).map((e) => e.code);

  it("reports a missing argument", () => {
    expect(withEffect(`emit save()`)).toEqual(["E0213"]);
  });

  it("reports an extra argument", () => {
    expect(withEffect(`emit save("a", "b")`)).toEqual(["E0213"]);
  });

  it("reports an argument of the wrong type", () => {
    expect(withEffect(`emit save(1)`)).toEqual(["E0202"]);
  });

  it("accepts a correctly typed argument", () => {
    expect(withEffect(`emit save("k")`)).toEqual([]);
  });

  it("takes no argument when in= is Unit", () => {
    const src = `effect ping cap=storage.write in=Unit out=Result(Unit, Text)
reducer r on=ui.click(B) do= emit ping()
${caps}`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
  });
});

describe("tile in=", () => {
  it("reports a call with no argument to a tile that declares in=", () => {
    expect(prog(`tile Row in=Text = box(text($1))\ntile Home = Row()`)).toEqual(["E0213"]);
  });

  it("reports an argument of the wrong type", () => {
    expect(prog(`tile Row in=Text = box(text($1))\ntile Home = Row(1)`)).toEqual(["E0201"]);
  });

  it("accepts a correctly typed argument", () => {
    expect(prog(`tile Row in=Text = box(text($1))\ntile Home = Row("a")`)).toEqual([]);
  });

  it("reports an argument passed to a tile that declares no in=", () => {
    expect(prog(`tile Row = box(text("x"))\ntile Home = Row("a")`)).toEqual(["E0213"]);
  });
});

describe("undefined type names (E0117)", () => {
  it("reports an unknown name in a slot type", () => {
    expect(prog(`slot v : NoSuchType = 1`)).toEqual(["E0117"]);
  });

  it("reports an unknown name in a fn parameter and return type", () => {
    expect(prog(`fn f(x: Nope) -> AlsoNope = x`)).toEqual(["E0117", "E0117"]);
  });

  it("reports an unknown name in an effect signature", () => {
    expect(prog(`effect e cap=storage.write in=Nope out=Result(Unit, Text)`)).toEqual(["E0117"]);
  });

  it("keeps a type parameter of the enclosing type definition in scope", () => {
    expect(prog(`type Box(T) = {v: T}\nslot b : Box(Int) = {v: 1}`)).toEqual([]);
  });

  it("reports a name that is not a parameter of the enclosing type definition", () => {
    expect(prog(`type Box(T) = {v: U}\nslot b : Box(Int) = {v: 1}`)).toEqual(["E0117"]);
  });

  it("accepts the stdlib containers without a type definition", () => {
    expect(
      prog(
        `slot a : List(Int) = []\nslot b : Map(Text, Int) = {}\nslot c : Set(Int) = []\nslot d : Option(Int) = None\nslot e : Result(Int, Text) = Ok(1)`,
      ),
    ).toEqual([]);
  });
});

describe("Int literal precision (E0217)", () => {
  it("reports a literal JavaScript cannot represent exactly", () => {
    expect(prog(`slot s : Int = 123456789012345678901234567890`)).toEqual(["E0217"]);
  });

  it("reports the first integer past the safe range", () => {
    expect(prog(`slot s : Int = 9007199254740993`)).toEqual(["E0217"]);
  });

  it("accepts the largest safe integer", () => {
    expect(prog(`slot s : Int = 9007199254740991`)).toEqual([]);
  });

  it("reports a fractional literal as a type mismatch, not a precision loss", () => {
    expect(prog(`slot s : Int = 0.5`)).toEqual(["E0201"]);
  });
});

describe(".copy()", () => {
  const P = `type P = {id: Int, name: Text}\nslot p : P = {id: 1, name: "n"}`;

  it("reports an undeclared field", () => {
    expect(inReducer(P, `p := p.copy(nosuchfield=1)`)).toEqual(["E0215"]);
  });

  it("checks the replacement value against the declared field type", () => {
    expect(inReducer(P, `p := p.copy(id="x")`)).toEqual(["E0201"]);
  });

  it("accepts a well-typed patch", () => {
    expect(inReducer(P, `p := p.copy(id=2)`)).toEqual([]);
  });
});

describe("operators", () => {
  const S = `slot n : Int = 0\nslot t : Text = "a"\nslot bl : Bool = true`;

  it("reports Text on the left of a subtraction", () => {
    expect(inReducer(S, `n := t - 1`)).toEqual(["E0201"]);
  });

  it("reports Bool in a multiplication", () => {
    expect(inReducer(S, `n := bl * 2`)).toEqual(["E0201"]);
  });

  it("accepts Text concatenation with a stringified operand", () => {
    expect(inReducer(S, `t := "count: " + n`)).toEqual([]);
  });

  it("reports a Bool operand of +", () => {
    expect(inReducer(S, `n := n + bl`)).toEqual(["E0201"]);
  });

  it("reports a non-Bool operand of &", () => {
    expect(inReducer(S, `bl := n & t`)).toEqual(["E0201", "E0201"]);
  });

  it("reports an ordering comparison across incomparable types", () => {
    expect(inReducer(S, `bl := n < t`)).toEqual(["E0201"]);
  });

  it("accepts ordering on two Texts", () => {
    expect(inReducer(S, `bl := t < "b"`)).toEqual([]);
  });

  it("reports a non-Bool if condition in a reducer", () => {
    expect(inReducer(S, `if n then n := 1 else n := 2`)).toEqual(["E0201"]);
  });

  it("reports a non-Bool if condition in an expression", () => {
    expect(inReducer(S, `n := if t then 1 else 2`)).toEqual(["E0201"]);
  });

  it("reports a non-Bool operand of !", () => {
    expect(inReducer(S, `bl := !n`)).toEqual(["E0201"]);
  });

  it("reports a negation of a non-numeric", () => {
    expect(inReducer(S, `n := -t`)).toEqual(["E0201"]);
  });
});

describe("division yields Float (language.md §1.9.4)", () => {
  it("reports an Int slot assigned a quotient", () => {
    expect(inReducer(`slot n : Int = 0`, `n := 5 / 2`)).toEqual(["E0201"]);
  });

  it("accepts a Float slot assigned a quotient", () => {
    expect(inReducer(`slot f : Float = 0.0`, `f := 5 / 2`)).toEqual([]);
  });

  it("accepts a quotient in an Int position once converted", () => {
    expect(inReducer(`slot n : Int = 0`, `n := (5 / 2).to-int`)).toEqual([]);
  });

  it("keeps the other arithmetic operators at Int", () => {
    expect(inReducer(`slot n : Int = 0`, `n := 5 * 2 + 1 - 3 % 2`)).toEqual([]);
  });

  it("reports a fn that returns Int from a division", () => {
    expect(prog(`fn half(x: Int) -> Int = x / 2`)).toEqual(["E0201"]);
  });
});

describe("undecidable types stay silent", () => {
  it("says nothing about a value whose type cannot be inferred", () => {
    expect(inReducer(`slot n : Int = 0\nslot l : List(Int) = []`, `n := l.head`)).toEqual([]);
  });

  it("says nothing about an opaque type parameter", () => {
    expect(prog(`type Box(T) = {v: T}\ntype Pair(T) = {a: Box(T), b: T}`)).toEqual([]);
  });

  it("does not carry an outer $1 into a method-call argument", () => {
    // `$1` inside `.map(...)` is the element, not the tile's `in=`. Carrying
    // the tile's type in reported `formatDate($1)` — which is correct code —
    // as a mismatch, on a recorded benchmark program that compiles and runs.
    expect(
      prog(
        `type Id = nominal Text where uuid
slot due : Map(Id, Option(Time)) = {}
fn formatDate(t: Time) -> Text = t.show
tile Due in=Id = text(due[$1].map(formatDate($1)).get-or(""))`,
      ),
    ).toEqual([]);
  });

  it("says nothing about a match arm binding", () => {
    expect(
      inReducer(
        `slot o : Option(Int) = None\nslot n : Int = 0`,
        `match o with | Some(v) -> n := v | None -> n := 0`,
      ),
    ).toEqual([]);
  });
});

/**
 * `relate` is only reached when neither side is a literal, which in practice
 * means slot-to-slot assignment. Every record and union case above goes down
 * the literal path instead, so without these the whole relation could be
 * replaced by `() => true` and stay green.
 */
describe("the assignability relation itself", () => {
  const assign = (defs: string, lhs: string, rhs: string) => inReducer(defs, `${lhs} := ${rhs}`);

  it("refuses a record missing a declared field", () => {
    expect(
      assign(
        `type P = {a: Int, b: Int}\ntype Q = {a: Int}\nslot p : P = {a: 1, b: 2}\nslot q : Q = {a: 1}`,
        "p",
        "q",
      ),
    ).toEqual(["E0201"]);
  });

  it("refuses a record carrying a field the target does not declare", () => {
    // Records get no width subtyping: the extra field would ride into a value
    // whose type says it is not there, and every later read of that value is
    // checked against a shape it does not have.
    expect(
      assign(
        `type P = {a: Int}\ntype Q = {a: Int, b: Int}\nslot p : P = {a: 1}\nslot q : Q = {a: 1, b: 2}`,
        "p",
        "q",
      ),
    ).toEqual(["E0201"]);
  });

  it("refuses a container whose element type differs", () => {
    expect(assign(`slot li : List(Int) = []\nslot lt : List(Text) = []`, "li", "lt")).toEqual([
      "E0201",
    ]);
  });

  it("refuses a different container of the same element type", () => {
    expect(assign(`slot li : List(Int) = []\nslot si : Set(Int) = {}`, "li", "si")).toEqual([
      "E0201",
    ]);
  });

  it("refuses a union whose variant payloads differ", () => {
    expect(
      assign(
        `type A = Idle | Busy(Int)\ntype B = Idle | Busy(Text)\nslot a : A = Idle\nslot b : B = Idle`,
        "a",
        "b",
      ),
    ).toEqual(["E0201"]);
  });

  it("refuses a scalar where a tuple is declared", () => {
    // The tuple slot is initialised from `.zip`, whose result type is
    // undecidable, so the only diagnostic left is the assignment itself.
    expect(
      assign(`slot t : Tuple(Int, Text) = [1].zip(["a"])\nslot n : Int = 0`, "t", "n"),
    ).toEqual(["E0201"]);
  });

  it("accepts a container of the same shape", () => {
    expect(assign(`slot a : List(Int) = []\nslot b : List(Int) = []`, "a", "b")).toEqual([]);
  });
});

/**
 * A recursive type is what an LLM reaches for first — a comment tree, a file
 * tree, a nested todo. `unaliasType`'s cycle guard covers one normalisation,
 * so the relation needs its own or it recurses until the stack gives out: a
 * `RangeError` thrown out of `check`, not a diagnostic.
 */
describe("recursive types terminate", () => {
  const RECURSIVE: [string, string][] = [
    ["a record naming itself", `type Node = {value: Int, next: Node}\nfn f(n: Node) -> Node = n`],
    ["two records naming each other", `type A = {b: B}\ntype B = {a: A}\nfn f(x: A) -> A = x`],
    ["a union naming itself", `type Tree = Leaf | Branch(Tree, Tree)\nfn f(t: Tree) -> Tree = t`],
    [
      "a record reaching itself through a container",
      `type Comment = {id: Int, body: Text, replies: List(Comment)}\nfn f(c: Comment) -> Comment = c`,
    ],
  ];

  for (const [label, src] of RECURSIVE) {
    it(`checks ${label} without exhausting the stack`, () => {
      expect(() => prog(src)).not.toThrow();
      expect(prog(src)).toEqual([]);
    });
  }

  it("still reports a mismatch inside a recursive type", () => {
    expect(
      prog(
        `type Node = {value: Int, next: Option(Node)}\nslot n : Node = {value: "x", next: None}`,
      ),
    ).toEqual(["E0201"]);
  });
});

/**
 * `substituteType` is what instantiates a generic. Replaced with the identity,
 * every argument degrades to an opaque type parameter — which the relation
 * accepts — so a test that only asserts `[]` cannot tell the two apart.
 */
describe("generic instantiation", () => {
  it("checks a field against the instantiated parameter", () => {
    expect(prog(`type Box(T) = {v: T}\nslot b : Box(Int) = {v: "x"}`)).toEqual(["E0201"]);
  });

  it("checks through a container of the parameter", () => {
    expect(prog(`type Box(T) = {v: List(T)}\nslot b : Box(Int) = {v: ["a"]}`)).toEqual(["E0201"]);
  });

  it("checks a nested instantiation", () => {
    expect(
      prog(
        `type Box(T) = {v: T}\ntype Pair(A) = {l: Box(A), r: Box(A)}\nslot p : Pair(Int) = {l: {v: 1}, r: {v: "x"}}`,
      ),
    ).toEqual(["E0201"]);
  });

  it("accepts a correct instantiation", () => {
    expect(prog(`type Box(T) = {v: T}\nslot b : Box(Int) = {v: 1}`)).toEqual([]);
  });

  it("reports a generic named without its arguments", () => {
    // `Box` alone expands with `T` unsubstituted, and an unsubstituted
    // parameter is opaque — so everything typed by it would stop being checked.
    expect(prog(`type Box(T) = {v: T}\nslot b : Box = {v: 1}`)).toEqual(["E0210"]);
  });
});

/**
 * `fix.ts` parses these with regexes and the debug skill quotes them, so the
 * wording is an interface. `spec-drift` compares codes and `spec-index`
 * compares the two documents to each other; neither reads a message.
 */
describe("diagnostic messages", () => {
  const firstMessage = (src: string) => check(parse(lex(`${src}\n${TAIL}`)))[0]?.message;

  it("names the literal as written and the value it became", () => {
    expect(firstMessage(`slot n : Int = 9007199254740993`)).toBe(
      "Int literal 9007199254740993 is not exactly representable and was rounded to 9007199254740992",
    );
  });

  it("names both types in an assignment mismatch", () => {
    expect(firstMessage(`slot n : Int = "x"`)).toBe("Expected Int but got Text");
  });

  it("names the declared type in an unknown-variant message, as E0209 does", () => {
    // `fix.ts` extracts the second quoted name and resolves its tags from it.
    expect(firstMessage(`type S = Idle | Busy\nslot s : S = Zork`)).toBe(
      'Variant "Zork" is not a member of type "S"',
    );
  });

  it("prints an undecidable type argument rather than dropping it", () => {
    // `?` is `unknownType` reaching the reader: `List(?)` says the value is a
    // list and its element type could not be worked out.
    expect(firstMessage(`slot n : Int = []`)).toBe("Expected Int but got List(?)");
  });
});

/**
 * The one-sided design is the load-bearing claim, so the silences need pinning
 * as much as the reports do — each of these would be a false positive on a
 * program that runs.
 */
describe("more that stays silent", () => {
  it("says nothing about a refinement, which the runtime evaluates instead", () => {
    expect(
      inReducer(`type N = nominal Int where between(0, 999)\nslot c : N = 0`, `c := 5000`),
    ).toEqual([]);
  });

  it("does not carry an outer $2 into a method-call argument", () => {
    expect(
      prog(
        `slot rows : List(Int) = []
fn pick(a: Int, b: Int) -> Int = a + b
tile Sum in=Text = text(rows.fold(0, pick($1, $2)).show)`,
      ),
    ).toEqual([]);
  });

  it("says nothing about .copy on a receiver that is not a record", () => {
    expect(inReducer(`slot n : Int = 0`, `n := n.copy(z=1)`)).toEqual([]);
  });

  it("says nothing about an operator with one unresolved side", () => {
    expect(inReducer(`slot t : Text = ""\nslot l : List(Text) = []`, `t := l.head + "x"`)).toEqual(
      [],
    );
  });
});

/**
 * A binding shadows whatever the name meant outside it. Before `bindLocal`,
 * only the name was rebound and the outer type stayed behind, so an inner loop
 * variable was reported as the type of an outer `let`.
 */
describe("a re-binding does not inherit the outer type", () => {
  it("for-bind over a let of a different type", () => {
    expect(
      inReducer(
        `slot names : List(Text) = ["a"]\nslot total : Text = ""`,
        `let x = 5\n  for x in names\n    total := x`,
      ),
    ).toEqual([]);
  });

  it("match-bind over a let of a different type", () => {
    expect(
      inReducer(
        `slot o : Option(Text) = None\nslot t : Text = ""`,
        `let v = 5\n  match o with | Some(v) -> t := v | None -> t := ""`,
      ),
    ).toEqual([]);
  });

  it("still types the for-bind from its own container", () => {
    expect(
      inReducer(`slot names : List(Text) = ["a"]\nslot n : Int = 0`, `for x in names\n    n := x`),
    ).toEqual(["E0201"]);
  });
});
