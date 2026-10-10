import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { withButtonApp, withReducer, withRoot } from "./helpers/programs.ts";

const appCodes = (defs: string) => codesOf(withButtonApp(defs));
const reducerCodes = (defs: string, body: string) => codesOf(withReducer(defs, body));

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
      const found = checkSource(withButtonApp(src)).filter((e) => e.code === code);
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
    const found = checkSource(src).filter((e) => e.code === "E0202");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.kind).toBe("emit-arg-type-mismatch");
  });
});

describe("slot assignment", () => {
  it("reports a Text rhs for an Int slot", () => {
    expect(reducerCodes(`slot n : Int = 0`, `n := "not a number"`)).toEqual(["E0201"]);
  });

  it("checks through a record field path", () => {
    expect(reducerCodes(`type P = {id: Int}\nslot p : P = {id: 1}`, `p.id := "x"`)).toEqual([
      "E0201",
    ]);
  });

  it("checks through a list index path", () => {
    expect(reducerCodes(`slot l : List(Int) = []`, `l[0] := "x"`)).toEqual(["E0201"]);
  });

  it("checks through a map index path", () => {
    expect(reducerCodes(`slot m : Map(Text, Int) = {}`, `m["k"] := "x"`)).toEqual(["E0201"]);
  });

  it("accepts a correctly typed assignment", () => {
    expect(reducerCodes(`slot n : Int = 0`, `n := 1`)).toEqual([]);
  });
});

describe("fn application", () => {
  const F = `fn double(x: Int) -> Int = x * 2`;

  it("reports a Text argument for an Int parameter", () => {
    expect(reducerCodes(`slot n : Int = 0\n${F}`, `n := double("hello")`)).toEqual(["E0201"]);
  });

  it("accepts a correctly typed argument", () => {
    expect(reducerCodes(`slot n : Int = 0\n${F}`, `n := double(n)`)).toEqual([]);
  });

  it("reports a return type the body cannot produce", () => {
    expect(appCodes(`fn label(x: Int) -> Text = x`)).toEqual(["E0201"]);
  });

  it("accepts a body that matches the return type", () => {
    expect(appCodes(`fn label(x: Int) -> Text = x.show`)).toEqual([]);
  });

  it("still reports arity separately from types", () => {
    expect(reducerCodes(`slot n : Int = 0\n${F}`, `n := double()`)).toEqual(["E0213"]);
  });
});

describe("emit", () => {
  const E = `effect save cap=storage.write in=Text out=Result(Unit, Text)`;
  const caps = `tile B = button(text="b")
tile App = column(B)
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
`;
  const withEffect = (body: string) =>
    codesOf(`${E}\nreducer r on=ui.click(B) do= ${body}\n${caps}`);

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
    expect(codesOf(src)).toEqual([]);
  });
});

describe("tile in=", () => {
  it("reports a call with no argument to a tile that declares in=", () => {
    expect(appCodes(`tile Row in=Text = box(text($1))\ntile Home = Row()`)).toEqual(["E0213"]);
  });

  it("reports an argument of the wrong type", () => {
    expect(appCodes(`tile Row in=Text = box(text($1))\ntile Home = Row(1)`)).toEqual(["E0201"]);
  });

  it("accepts a correctly typed argument", () => {
    expect(appCodes(`tile Row in=Text = box(text($1))\ntile Home = Row("a")`)).toEqual([]);
  });

  it("reports an argument passed to a tile that declares no in=", () => {
    expect(appCodes(`tile Row = box(text("x"))\ntile Home = Row("a")`)).toEqual(["E0213"]);
  });
});

describe("undefined type names (E0117)", () => {
  it("reports an unknown name in a slot type", () => {
    expect(appCodes(`slot v : NoSuchType = 1`)).toEqual(["E0117"]);
  });

  it("reports an unknown name in a fn parameter and return type", () => {
    expect(appCodes(`fn f(x: Nope) -> AlsoNope = x`)).toEqual(["E0117", "E0117"]);
  });

  it("reports an unknown name in an effect signature", () => {
    expect(appCodes(`effect e cap=storage.write in=Nope out=Result(Unit, Text)`)).toEqual([
      "E0117",
    ]);
  });

  it("keeps a type parameter of the enclosing type definition in scope", () => {
    expect(appCodes(`type Box(T) = {v: T}\nslot b : Box(Int) = {v: 1}`)).toEqual([]);
  });

  it("reports a name that is not a parameter of the enclosing type definition", () => {
    expect(appCodes(`type Box(T) = {v: U}\nslot b : Box(Int) = {v: 1}`)).toEqual(["E0117"]);
  });

  it("accepts the stdlib containers without a type definition", () => {
    expect(
      appCodes(
        `slot a : List(Int) = []\nslot b : Map(Text, Int) = {}\nslot c : Set(Int) = []\nslot d : Option(Int) = None\nslot e : Result(Int, Text) = Ok(1)`,
      ),
    ).toEqual([]);
  });

  it.each([
    ["a slot type", `slot y : Foo(Int) = 1`],
    ["a fn parameter", `fn f(x: Foo(Int)) -> Int = 1\nslot s : Int = f(1)`],
    ["a fn parameter used as its result", `fn f(x: Foo(Int)) -> Int = x`],
    ["a fn result", `fn h() -> Foo(Int) = 1`],
    ["a record field", `type R = {a: Foo(Int)}\nslot r : R = {a: 1}`],
    ["a variant payload", `type U = Has(Foo(Int)) | Empty\nslot u : U = Has(1)`],
    ["a List element", `slot l : List(Foo(Int)) = [1]`],
    ["an Option payload", `slot o : Option(Foo(Int)) = Some(1)`],
    ["an alias", `type A = Foo(Int)\nslot a : A = 1`],
    ["a declared generic's argument", `type NE(T) = T where nonempty\nslot r : NE(Foo(Int)) = 1`],
    ["two arguments", `slot y : Foo(Int, Text) = 1`],
    ["a nominal", `type N = nominal Foo(Int)\nslot n : N = 1`],
    ["an inline nominal", `slot n : nominal Foo(Int) = 1`],
    ["a refinement", `slot r : Foo(Int) where positive = 1`],
    ["a misspelt stdlib constructor", `slot l : Lst(Int) = [1]`],
    ["a primitive written with arguments", `slot z : Int() = 1`],
  ])("reports an undefined type applied in %s once", (_where, defs) => {
    expect(appCodes(defs)).toEqual(["E0117"]);
  });

  it.each([
    `n := y`,
    `n := y + 1`,
    `y := "x"`,
    `n := match y with | Some(v) -> 1 | None -> 0`,
  ])("reports nothing more where a value of an undefined application is used: %s", (body) => {
    expect(reducerCodes(`slot y : Foo(Int) = 1\nslot n : Int = 0`, body)).toEqual(["E0117"]);
  });

  it.each([
    [`slot l : List(Int) = ["x"]`, ["E0201"]],
    [`slot l : List(Int) = "x"`, ["E0201"]],
    [`slot o : Option(Text) = 1`, ["E0201"]],
    [`slot o : Option(Text) = Some(1)`, ["E0201"]],
    [`type G(T) = {v: T}\nslot g : G(Int) = {v: "x"}`, ["E0201"]],
    [`type G(T) = {v: T}\nslot g : G(Int) = {v: 1}`, []],
  ])("still checks a value against a stdlib constructor or a declared generic: %s", (defs, want) => {
    expect(appCodes(defs)).toEqual(want);
  });
});

describe("Int literal precision (E0217)", () => {
  it("reports a literal JavaScript cannot represent exactly", () => {
    expect(appCodes(`slot s : Int = 123456789012345678901234567890`)).toEqual(["E0217"]);
  });

  it("reports the first integer past the safe range", () => {
    expect(appCodes(`slot s : Int = 9007199254740993`)).toEqual(["E0217"]);
  });

  it("accepts the largest safe integer", () => {
    expect(appCodes(`slot s : Int = 9007199254740991`)).toEqual([]);
  });

  it("reports a fractional literal as a type mismatch, not a precision loss", () => {
    expect(appCodes(`slot s : Int = 0.5`)).toEqual(["E0201"]);
  });
});

describe(".copy()", () => {
  const P = `type P = {id: Int, name: Text}\nslot p : P = {id: 1, name: "n"}`;

  it("reports an undeclared field", () => {
    expect(reducerCodes(P, `p := p.copy(nosuchfield=1)`)).toEqual(["E0215"]);
  });

  it("checks the replacement value against the declared field type", () => {
    expect(reducerCodes(P, `p := p.copy(id="x")`)).toEqual(["E0201"]);
  });

  it("accepts a well-typed patch", () => {
    expect(reducerCodes(P, `p := p.copy(id=2)`)).toEqual([]);
  });
});

describe("operators", () => {
  const S = `slot n : Int = 0\nslot t : Text = "a"\nslot bl : Bool = true`;

  it("reports Text on the left of a subtraction", () => {
    expect(reducerCodes(S, `n := t - 1`)).toEqual(["E0201"]);
  });

  it("reports Bool in a multiplication", () => {
    expect(reducerCodes(S, `n := bl * 2`)).toEqual(["E0201"]);
  });

  it("accepts Text concatenation with a stringified operand", () => {
    expect(reducerCodes(S, `t := "count: " + n`)).toEqual([]);
  });

  it("reports a Bool operand of +", () => {
    expect(reducerCodes(S, `n := n + bl`)).toEqual(["E0201"]);
  });

  it("reports a non-Bool operand of &", () => {
    expect(reducerCodes(S, `bl := n & t`)).toEqual(["E0201", "E0201"]);
  });

  it("reports an ordering comparison across incomparable types", () => {
    expect(reducerCodes(S, `bl := n < t`)).toEqual(["E0201"]);
  });

  it("accepts ordering on two Texts", () => {
    expect(reducerCodes(S, `bl := t < "b"`)).toEqual([]);
  });

  it("reports a non-Bool if condition in a reducer", () => {
    expect(reducerCodes(S, `if n then n := 1 else n := 2`)).toEqual(["E0201"]);
  });

  it("reports a non-Bool if condition in an expression", () => {
    expect(reducerCodes(S, `n := if t then 1 else 2`)).toEqual(["E0201"]);
  });

  it("reports a non-Bool operand of !", () => {
    expect(reducerCodes(S, `bl := !n`)).toEqual(["E0201"]);
  });

  it("reports a negation of a non-numeric", () => {
    expect(reducerCodes(S, `n := -t`)).toEqual(["E0201"]);
  });
});

describe("division yields Float", () => {
  it("reports an Int slot assigned a quotient", () => {
    expect(reducerCodes(`slot n : Int = 0`, `n := 5 / 2`)).toEqual(["E0201"]);
  });

  it("accepts a Float slot assigned a quotient", () => {
    expect(reducerCodes(`slot f : Float = 0.0`, `f := 5 / 2`)).toEqual([]);
  });

  it("accepts a quotient in an Int position once converted", () => {
    expect(reducerCodes(`slot n : Int = 0`, `n := (5 / 2).to-int`)).toEqual([]);
  });

  it("keeps the other arithmetic operators at Int", () => {
    expect(reducerCodes(`slot n : Int = 0`, `n := 5 * 2 + 1 - 3 % 2`)).toEqual([]);
  });

  it("reports a fn that returns Int from a division", () => {
    expect(appCodes(`fn half(x: Int) -> Int = x / 2`)).toEqual(["E0201"]);
  });
});

describe("undecidable types stay silent", () => {
  it("says nothing about a value whose type cannot be inferred", () => {
    expect(reducerCodes(`slot n : Int = 0`, `n := $event.head`)).toEqual([]);
  });

  it("says nothing about a member whose result a lambda body decides", () => {
    expect(reducerCodes(`slot n : Int = 0\nslot l : List(Int) = []`, `n := l.map($1 + 1)`)).toEqual(
      [],
    );
  });

  it("says nothing about an opaque type parameter", () => {
    expect(appCodes(`type Box(T) = {v: T}\ntype Pair(T) = {a: Box(T), b: T}`)).toEqual([]);
  });

  it("does not carry an outer $1 into a method-call argument", () => {
    expect(
      appCodes(
        `type Id = nominal Text where uuid
slot due : Map(Id, Option(Time)) = {}
fn formatDate(t: Time) -> Text = t.show
tile Due in=Id = text(due[$1].map(formatDate($1)).get-or(""))`,
      ),
    ).toEqual([]);
  });

  it("says nothing about a match arm binding", () => {
    expect(
      reducerCodes(
        `slot o : Option(Int) = None\nslot n : Int = 0`,
        `match o with | Some(v) -> n := v | None -> n := 0`,
      ),
    ).toEqual([]);
  });
});

describe("diagnostic messages", () => {
  const firstMessage = (src: string) => checkSource(withButtonApp(src))[0]?.message;

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
    expect(firstMessage(`slot n : Int = []`)).toBe("Expected Int but got List(?)");
  });
});

describe("more that stays silent", () => {
  it("says nothing about a refinement, which the runtime evaluates instead", () => {
    expect(
      reducerCodes(`type N = nominal Int where between(0, 999)\nslot c : N = 0`, `c := 5000`),
    ).toEqual([]);
  });

  it("does not carry an outer $2 into a method-call argument", () => {
    expect(
      appCodes(
        `slot rows : List(Int) = []
fn pick(a: Int, b: Int) -> Int = a + b
tile Sum in=Text = text(rows.fold(0, pick($1, $2)).show)`,
      ),
    ).toEqual([]);
  });

  it("says nothing about an operator with one unresolved side", () => {
    expect(reducerCodes(`slot t : Text = ""`, `t := $event.head + "x"`)).toEqual([]);
  });

  it("does not yet report an Option operand of +", () => {
    expect(
      reducerCodes(`slot t : Text = ""\nslot l : List(Text) = []`, `t := l.head + "x"`),
    ).not.toContain("E0201");
  });
});

describe("a re-binding does not inherit the outer type", () => {
  it("for-bind over a let of a different type", () => {
    expect(
      reducerCodes(
        `slot names : List(Text) = ["a"]\nslot total : Text = ""`,
        `let x = 5\n  for x in names\n    total := x`,
      ),
    ).toEqual([]);
  });

  it("match-bind over a let of a different type", () => {
    expect(
      reducerCodes(
        `slot o : Option(Text) = None\nslot t : Text = ""`,
        `let v = 5\n  match o with | Some(v) -> t := v | None -> t := ""`,
      ),
    ).toEqual([]);
  });

  it("still types the for-bind from its own container", () => {
    expect(
      reducerCodes(
        `slot names : List(Text) = ["a"]\nslot n : Int = 0`,
        `for x in names\n    n := x`,
      ),
    ).toEqual(["E0201"]);
  });
});

describe("for over a Map or a Set is E0218", () => {
  const MAP = "slot names : Map(Text, Text) = {}";
  const SET = "slot tags : Set(Text) = {}";

  it("reports the tile form", () => {
    const src = `${MAP}
tile App = column(for k in names text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual(["E0218"]);
  });

  it("reports the reducer form, which is a different node", () => {
    const src = withRoot(
      'text("x")',
      `${MAP}
slot n : Int = 0
reducer count on=app.start do=
    for k in names
        n := n + 1`,
    );
    expect(codesOf(src)).toEqual(["E0218"]);
  });

  it("reports a Set, which is a keyed object too", () => {
    const src = `${SET}
tile App = column(for t in tags text(t))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const diags = checkSource(src);
    expect(diags.map((d) => d.code)).toEqual(["E0218"]);
    expect(diags[0]?.message).toContain(".to-list");
  });

  it("sees through a type alias", () => {
    const src = `type Names = Map(Text, Text)
slot names : Names = {}
tile App = column(for k in names text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual(["E0218"]);
  });

  it("accepts the two forms the spec names, and a plain List", () => {
    const src = `${MAP}
${SET}
slot xs : List(Text) = []
tile App = column(
             for k in names.keys text(k),
             for t in tags.to-list text(t),
             for x in xs text(x))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual([]);
  });

  it("stays silent when the type cannot be determined", () => {
    const src = `tile App = column(for r in nope text(r))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual(["E0103"]);
  });

  it("accepts a List that comes back from a fn", () => {
    const src = `slot xs : List(Text) = []
fn rows(ys: List(Text)) -> List(Text) = ys
tile App = column(for r in rows(xs) text(r))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual([]);
  });
});
