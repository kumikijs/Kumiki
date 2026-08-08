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

  it("says nothing about a match arm binding", () => {
    expect(
      inReducer(
        `slot o : Option(Int) = None\nslot n : Int = 0`,
        `match o with | Some(v) -> n := v | None -> n := 0`,
      ),
    ).toEqual([]);
  });
});
