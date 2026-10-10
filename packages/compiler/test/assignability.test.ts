import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { withButtonApp, withReducer } from "./helpers/programs.ts";

const appCodes = (defs: string) => codesOf(withButtonApp(defs));
const reducerCodes = (defs: string, body: string) => codesOf(withReducer(defs, body));

describe("assignability — prims", () => {
  it("reports a Text literal in an Int slot", () => {
    expect(checkSource(withButtonApp(`slot n : Int = "hello"`))).toEqual([
      {
        code: "E0201",
        kind: "type-mismatch",
        message: "Expected Int but got Text",
        pos: { line: 1, col: 16 },
      },
    ]);
  });

  it("reports an Int literal in a Text slot", () => {
    expect(appCodes(`slot t : Text = 1`)).toEqual(["E0201"]);
  });

  it("reports a Bool literal in a Text slot", () => {
    expect(appCodes(`slot t : Text = true`)).toEqual(["E0201"]);
  });

  it("widens Int to Float", () => {
    expect(appCodes(`slot f : Float = 0`)).toEqual([]);
  });

  it("does not narrow Float to Int", () => {
    expect(appCodes(`slot n : Int = 0.5`)).toEqual(["E0201"]);
  });

  it("accepts a Float literal in a Float slot", () => {
    expect(appCodes(`slot f : Float = 0.5`)).toEqual([]);
  });

  it("accepts matching prims", () => {
    expect(appCodes(`slot n : Int = 1\nslot t : Text = "a"\nslot b : Bool = false`)).toEqual([]);
  });
});

describe("assignability — nominal, refinement and aliases", () => {
  it("accepts the underlying prim through a nominal wrapper", () => {
    expect(appCodes(`type N = nominal Int where between(0, 999)\nslot c : N = 0`)).toEqual([]);
  });

  it("reports the wrong prim through a nominal wrapper", () => {
    expect(appCodes(`type N = nominal Int where between(0, 999)\nslot c : N = "0"`)).toEqual([
      "E0201",
    ]);
  });

  it("follows an alias chain", () => {
    expect(appCodes(`type A = Int\ntype B = A\nslot n : B = "x"`)).toEqual(["E0201"]);
  });

  it("accepts anything for a type name that resolves to nothing", () => {
    // The name itself is reported (E0117); the value is not double-reported.
    expect(appCodes(`slot v : NoSuchType = 1`)).toEqual(["E0117"]);
  });
});

describe("assignability — a nominal type is distinct from every other one", () => {
  const MONEY = `type Cents = nominal Int where positive
type Yen   = nominal Int where positive
slot c : Cents = 1
slot y : Yen   = 2
slot n : Int   = 3`;

  it("reports one nominal assigned to another over the same base", () => {
    const errs = checkSource(withButtonApp(`${MONEY}\nreducer r on=ui.click(B) do= c := y`));
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe("Expected Cents but got Yen");
  });

  it("accepts a base literal in a nominal slot", () => {
    expect(appCodes(MONEY)).toEqual([]);
  });

  it("accepts the base in a nominal position and the nominal in a base position", () => {
    expect(reducerCodes(MONEY, `c := n`)).toEqual([]);
    expect(reducerCodes(MONEY, `n := c`)).toEqual([]);
  });

  it("accepts arithmetic on a nominal, which yields its base", () => {
    expect(reducerCodes(MONEY, `c := c + 1`)).toEqual([]);
  });

  it("still accepts a value outside the refinement", () => {
    expect(
      reducerCodes(
        `type Volume = nominal Int where between(0, 11)\nslot v : Volume = 5`,
        `v := 50`,
      ),
    ).toEqual([]);
    expect(appCodes(`slot e : Email = "not-an-email"`)).toEqual([]);
  });

  it("treats an alias to a nominal as the same type", () => {
    const src = `type Cents = nominal Int where positive
type Money = Cents
type Kept  = Cents where positive
slot c : Cents = 1
slot m : Money = 2
slot k : Kept  = 3`;
    expect(appCodes(src)).toEqual([]);
    expect(reducerCodes(src, `m := c`)).toEqual([]);
    expect(reducerCodes(src, `c := m`)).toEqual([]);
    // A refinement on the way to the nominal does not hide it either.
    expect(reducerCodes(src, `k := c`)).toEqual([]);
    expect(
      reducerCodes(`${src}\ntype Yen = nominal Int where positive\nslot y : Yen = 4`, `k := y`),
    ).toEqual(["E0201"]);
  });

  it("terminates on an alias cycle", () => {
    const src = `type A = B\ntype B = A\nslot x : A = 1\nslot n : Int = 0`;
    expect(reducerCodes(src, `n := [x, x].length`)).toEqual(["E0009"]);
    const rec = `${src}\ntype R = {v: Int}\nslot r : R = {v: 0}`;
    expect(reducerCodes(rec, `r := {v: x}`)).toEqual(["E0009"]);

    const nominalCycle = `type A2 = nominal B2
type B2 = nominal A2
slot p : A2 = 1
slot q : B2 = 2
slot n : Int = 0`;
    expect(reducerCodes(nominalCycle, `n := [p, q].length`)).toEqual(["E0009"]);
  });

  it("resolves a generic alias with its argument, not with a name that shadows it", () => {
    const shadow = `type Cents = nominal Int where positive
type Yen   = nominal Int where positive
type Alias(Cents) = Cents
slot y : Yen = 1
slot a : Alias(Yen) = 2`;
    expect(reducerCodes(shadow, `y := a`)).toEqual([]);

    const wrapped = `type Cents = nominal Int where positive
type Yen   = nominal Int where positive
type Validated(T) = T where positive
slot w : Validated(Cents) = 1
slot y : Yen = 2`;
    expect(reducerCodes(wrapped, `y := w`)).toEqual(["E0201"]);
    expect(reducerCodes(wrapped, `w := w`)).toEqual([]);
  });

  it("keeps the identity when a second refinement wraps the nominal", () => {
    const src = `type Cents = nominal Int where between(0, 100) where positive
type Yen   = nominal Int where positive
slot c : Cents = 1
slot y : Yen   = 2`;
    expect(reducerCodes(src, `c := y`)).toEqual(["E0201"]);
    expect(reducerCodes(src, `c := 1`)).toEqual([]);
  });

  it("accepts a nominal where one it is declared over is required, but not the reverse", () => {
    const src = `type Cents = nominal Int where positive
type Deep  = nominal Cents
slot c : Cents = 1
slot d : Deep  = 2
slot n : Int   = 3`;
    expect(appCodes(src)).toEqual([]);
    expect(reducerCodes(src, `c := d`)).toEqual([]);
    expect(reducerCodes(src, `d := c`)).toEqual(["E0201"]);
    // The structural base still meets both, in both directions.
    expect(reducerCodes(src, `d := n`)).toEqual([]);
    expect(reducerCodes(src, `n := d`)).toEqual([]);
  });

  it("takes no identity from a nominal written inline at a use site", () => {
    const src = `type Yen = nominal Int where positive
slot y : Yen = 1
slot x : nominal Int = 2`;
    expect(reducerCodes(src, `x := y`)).toEqual([]);
  });

  it("reports one standard-library nominal assigned to another", () => {
    const src = `slot u : Url   = "https://example.com"
slot e : Email = "a@example.com"`;
    const errs = checkSource(withButtonApp(`${src}\nreducer r on=ui.click(B) do= e := u`));
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe("Expected Email but got Url");
  });

  it("compares the arguments of a generic nominal, which shares its name", () => {
    const src = `type Box(T) = nominal List(T)
slot bi : Box(Int)  = [1]
slot bt : Box(Text) = ["a"]`;
    expect(appCodes(src)).toEqual([]);
    expect(reducerCodes(src, `bi := bt`)).toEqual(["E0201"]);
    expect(reducerCodes(src, `bi := bi`)).toEqual([]);
  });

  it("reports a nominal element inside a container", () => {
    const src = `${MONEY}\nslot l : List(Cents) = []`;
    expect(reducerCodes(src, `l := [y]`)).toEqual(["E0201"]);
    expect(reducerCodes(src, `l := [c]`)).toEqual([]);
    expect(reducerCodes(`${MONEY}\nslot o : Option(Cents) = None`, `o := Some(y)`)).toEqual([
      "E0201",
    ]);
    expect(reducerCodes(`${MONEY}\nslot m : Map(Text, Cents) = {}`, `m := {"a": y}`)).toEqual([
      "E0201",
    ]);
    const boxes = `${MONEY}\ntype Box(T) = nominal List(T)\nslot bc : Box(Cents) = []\nslot by : Box(Yen) = []`;
    const errs = checkSource(withButtonApp(`${boxes}\nreducer r on=ui.click(B) do= bc := by`));
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe("Expected Box(Cents) but got Box(Yen)");
  });

  it("answers the shared base when two nominals meet in one expression", () => {
    expect(
      reducerCodes(`${MONEY}\nslot flag : Bool = true`, `n := (if flag then c else y).abs`),
    ).toEqual([]);
    expect(
      reducerCodes(
        `${MONEY}\nslot t : Text = ""\nslot flag : Bool = true`,
        `t := (if flag then c else y).noSuchMember`,
      ),
    ).toEqual(["E0108"]);
    // Order-independent, which is the same property said the other way.
    expect(reducerCodes(`${MONEY}\nslot t : Text = ""`, `t := [n, c, y].length.show`)).toEqual([]);
    expect(reducerCodes(`${MONEY}\nslot t : Text = ""`, `t := [c, y, n].length.show`)).toEqual([]);
    expect(
      reducerCodes(
        `${MONEY}\nslot t : Text = ""\nslot s : Text = ""\nslot flag : Bool = true`,
        `t := (if flag then c else s).noSuchMember`,
      ),
    ).toEqual([]);
  });

  it("reports a nominal in each assignment, call, emit and tile-argument position", () => {
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
      codesOf(`${POSITIONS}\nreducer r on=ui.click(B) do= ${body}\n${app}`);

    expect(withBody(`w.balance := y`)).toEqual(["E0201"]);
    expect(withBody(`w.balance := add(y)`)).toEqual(["E0201"]);
    expect(withBody(`emit save(y)`)).toEqual(["E0202"]);
    expect(codesOf(`${POSITIONS}\ntile Home = Amount(y)\n${app}`)).toEqual(["E0201"]);
    expect(codesOf(`${POSITIONS}\nfn wrong(a: Yen) -> Cents = a\n${app}`)).toEqual(["E0201"]);
  });

  it("stays silent when either side is undecidable", () => {
    expect(appCodes(`type Cents = nominal Int where positive\nslot q : Q = 1`)).toEqual(["E0117"]);
    expect(
      reducerCodes(
        `type PostId = nominal Text where uuid
slot p : PostId = "a"
slot q : Q = "b"`,
        `p := q`,
      ),
    ).toEqual(["E0117"]);
  });

  it("reports a comparison across two nominals over one base", () => {
    for (const op of ["==", "!=", "<", "<=", ">", ">="]) {
      const errs = check(
        parse(
          lex(
            withButtonApp(`${MONEY}\nreducer r on=ui.click(B) do= n := if c ${op} y then 1 else 2`),
          ),
        ),
      );
      expect(
        errs.map((e) => e.code),
        op,
      ).toEqual(["E0201"]);
      expect(errs[0]?.message, op).toBe(`Operator "${op}" cannot compare Cents with Yen`);
    }
    const IDS = `type PostId = nominal Text where uuid
type UserId = nominal Text where uuid
slot p : PostId = "a"
slot u : UserId = "b"
slot n : Int = 0`;
    expect(reducerCodes(IDS, `n := if p == u then 1 else 2`)).toEqual(["E0201"]);
    expect(reducerCodes(IDS, `n := if p < u then 1 else 2`)).toEqual(["E0201"]);
  });

  it("reports an equality once, where ordering already reported", () => {
    const at = (op: string) =>
      check(
        parse(
          lex(
            withButtonApp(`${MONEY}\nreducer r on=ui.click(B) do= n := if c ${op} y then 1 else 2`),
          ),
        ),
      )[0]?.pos;
    const reducerLine = MONEY.split("\n").length + 1;
    expect(at("==")).toEqual({ line: reducerLine, col: 38 });
    expect(at("<")).toEqual(at("=="));
    // One, not one per side — the half of this that is not the column.
    expect(
      check(
        parse(
          lex(withButtonApp(`${MONEY}\nreducer r on=ui.click(B) do= n := if c == y then 1 else 2`)),
        ),
      ),
    ).toHaveLength(1);
  });

  it("does not read the identity below the top level, as an assignment does", () => {
    const LISTS = `${MONEY}\nslot lc : List(Cents) = []\nslot ly : List(Yen) = []`;
    expect(reducerCodes(LISTS, `n := if lc == ly then 1 else 2`)).toEqual([]);
    expect(reducerCodes(LISTS, `lc := ly`)).toEqual(["E0201"]);
  });

  it("compares a nominal with its base, as it assigns", () => {
    expect(reducerCodes(MONEY, `n := if c == 0 then 1 else 2`)).toEqual([]);
    expect(reducerCodes(MONEY, `n := if 0 == c then 1 else 2`)).toEqual([]);
    expect(reducerCodes(MONEY, `n := if c < n then 1 else 2`)).toEqual([]);
    expect(reducerCodes(MONEY, `n := if c == c then 1 else 2`)).toEqual([]);
    expect(
      reducerCodes(
        `type PostId = nominal Text where uuid\nslot p : PostId = "a"\nslot n : Int = 0`,
        `n := if p == "" then 1 else 2`,
      ),
    ).toEqual([]);
  });

  it("compares a nominal declared over another with the one it was declared as", () => {
    const DEEP = `${MONEY}\ntype Deep = nominal Cents\nslot d : Deep = 4`;
    expect(reducerCodes(DEEP, `n := if d == c then 1 else 2`)).toEqual([]);
    expect(reducerCodes(DEEP, `n := if c == d then 1 else 2`)).toEqual([]);
    expect(reducerCodes(DEEP, `n := if d == y then 1 else 2`)).toEqual(["E0201"]);
  });

  it("stays silent when either side of a comparison is undecidable", () => {
    expect(reducerCodes(`${MONEY}\nslot q : Q = 1`, `n := if c == q then 1 else 2`)).toEqual([
      "E0117",
    ]);
  });

  it("leaves an unrelated pair of shapes to the operator that already judges it", () => {
    expect(
      reducerCodes(
        `slot o : Option(Int) = None\nslot n : Int = 0`,
        `n := if o == None then 1 else 2`,
      ),
    ).toEqual([]);
    expect(
      reducerCodes(`slot t : Text = ""\nslot n : Int = 0`, `n := if t == 1 then 1 else 2`),
    ).toEqual([]);
    const errs = check(
      parse(
        lex(
          withButtonApp(
            `slot t : Text = ""\nslot n : Int = 0\nreducer r on=ui.click(B) do= n := if t < 1 then 1 else 2`,
          ),
        ),
      ),
    );
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Operator "<" cannot compare Text with Int`);
  });

  it("reports a nominal over a base no ordering is defined on once", () => {
    const FLAGS = `type Flag = nominal Bool
type Mark = nominal Bool
slot f : Flag = true
slot m : Mark = false
slot n : Int = 0`;
    const errs = check(
      parse(
        lex(withButtonApp(`${FLAGS}\nreducer r on=ui.click(B) do= n := if f < m then 1 else 2`)),
      ),
    );
    expect(errs.map((e) => e.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Operator "<" cannot compare Flag with Mark`);
  });
});

describe("assignability — containers", () => {
  it("reports the mismatched element of a list literal, at the element", () => {
    const errs = checkSource(withButtonApp(`slot l : List(Int) = [1, "a", true]`));
    expect(errs.map((e) => e.code)).toEqual(["E0201", "E0201"]);
    expect(errs[0]?.pos).toEqual({ line: 1, col: 26 });
    expect(errs[1]?.pos).toEqual({ line: 1, col: 31 });
  });

  it("accepts a homogeneous list literal", () => {
    expect(appCodes(`slot l : List(Int) = [1, 2, 3]`)).toEqual([]);
  });

  it("accepts an empty list literal for any element type", () => {
    expect(appCodes(`slot l : List(Text) = []`)).toEqual([]);
  });

  it("checks Map keys and values separately", () => {
    expect(appCodes(`slot m : Map(Text, Int) = {"a": 1, "b": "no"}`)).toEqual(["E0201"]);
    expect(appCodes(`slot m : Map(Text, Int) = {1: 1}`)).toEqual(["E0201"]);
  });

  it("accepts an empty map literal", () => {
    expect(appCodes(`slot m : Map(Text, Int) = {}`)).toEqual([]);
  });

  it("reports a scalar where a container is declared", () => {
    expect(appCodes(`slot l : List(Int) = 1`)).toEqual(["E0201"]);
  });

  it("does not descend into an element whose type is an unresolved type parameter", () => {
    expect(appCodes(`type Box(T) = {v: List(T)}\nslot b : Box(Int) = {v: [1, 2]}`)).toEqual([]);
  });
});

describe("assignability — Option and Result", () => {
  it("reports a bare value where Option is declared", () => {
    expect(appCodes(`slot o : Option(Int) = 5`)).toEqual(["E0201"]);
  });

  it("accepts None", () => {
    expect(appCodes(`slot o : Option(Int) = None`)).toEqual([]);
  });

  it("accepts Some of the right type", () => {
    expect(appCodes(`slot o : Option(Int) = Some(5)`)).toEqual([]);
  });

  it("reports Some of the wrong type", () => {
    expect(appCodes(`slot o : Option(Int) = Some("5")`)).toEqual(["E0201"]);
  });

  it("checks Ok against the success argument and Err against the error argument", () => {
    expect(appCodes(`slot r : Result(Int, Text) = Ok(1)`)).toEqual([]);
    expect(appCodes(`slot r : Result(Int, Text) = Err("boom")`)).toEqual([]);
    expect(appCodes(`slot r : Result(Int, Text) = Ok("1")`)).toEqual(["E0201"]);
    expect(appCodes(`slot r : Result(Int, Text) = Err(1)`)).toEqual(["E0201"]);
  });
});

describe("assignability — records", () => {
  const P = `type P = {id: Int, name: Text, age: Int}`;

  it("reports every mistyped field", () => {
    expect(appCodes(`${P}\nslot p : P = {id: 1, name: 2, age: "x"}`)).toEqual(["E0201", "E0201"]);
  });

  it("reports each missing field", () => {
    expect(appCodes(`${P}\nslot q : P = {id: 1}`)).toEqual(["E0214", "E0214"]);
  });

  it("reports an undeclared field", () => {
    expect(appCodes(`${P}\nslot r : P = {id: 1, name: "n", age: 3, extra: true}`)).toEqual([
      "E0215",
    ]);
  });

  it("accepts a complete, correctly typed record", () => {
    expect(appCodes(`${P}\nslot p : P = {id: 1, name: "n", age: 3}`)).toEqual([]);
  });

  it("checks a nested record field", () => {
    expect(
      appCodes(`type Inner = {n: Int}\ntype Outer = {i: Inner}\nslot o : Outer = {i: {n: "x"}}`),
    ).toEqual(["E0201"]);
  });

  it("reports a record literal where a prim is declared", () => {
    expect(appCodes(`slot n : Int = {a: 1}`)).toEqual(["E0201"]);
  });
});

describe("assignability — unions", () => {
  const S = `type S = Idle | Busy(Int)`;

  it("accepts a declared tag", () => {
    expect(appCodes(`${S}\nslot s : S = Idle`)).toEqual([]);
  });

  it("reports an undeclared tag", () => {
    expect(appCodes(`${S}\nslot s : S = Zork`)).toEqual(["E0216"]);
  });

  it("reports a payload arity mismatch", () => {
    expect(appCodes(`${S}\nslot s : S = Busy`)).toEqual(["E0213"]);
    expect(appCodes(`${S}\nslot s : S = Idle(1)`)).toEqual(["E0213"]);
  });

  it("checks the payload type", () => {
    expect(appCodes(`${S}\nslot s : S = Busy("x")`)).toEqual(["E0201"]);
    expect(appCodes(`${S}\nslot s : S = Busy(1)`)).toEqual([]);
  });

  it("reports a tag assigned to a slot in a reducer", () => {
    expect(reducerCodes(`${S}\nslot s : S = Idle`, `s := Zork`)).toEqual(["E0216"]);
  });
});

describe("the assignability relation itself", () => {
  const assign = (defs: string, lhs: string, rhs: string) => reducerCodes(defs, `${lhs} := ${rhs}`);

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
    expect(
      assign(`slot t : Tuple(Int, Text) = [1].zip(["a"])\nslot n : Int = 0`, "t", "n"),
    ).toEqual(["E0201"]);
  });

  it("accepts a container of the same shape", () => {
    expect(assign(`slot a : List(Int) = []\nslot b : List(Int) = []`, "a", "b")).toEqual([]);
  });
});

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
      expect(() => appCodes(src)).not.toThrow();
      expect(appCodes(src)).toEqual([]);
    });
  }

  it("still reports a mismatch inside a recursive type", () => {
    expect(
      appCodes(
        `type Node = {value: Int, next: Option(Node)}\nslot n : Node = {value: "x", next: None}`,
      ),
    ).toEqual(["E0201"]);
  });
});

describe("generic instantiation", () => {
  it("checks a field against the instantiated parameter", () => {
    expect(appCodes(`type Box(T) = {v: T}\nslot b : Box(Int) = {v: "x"}`)).toEqual(["E0201"]);
  });

  it("checks through a container of the parameter", () => {
    expect(appCodes(`type Box(T) = {v: List(T)}\nslot b : Box(Int) = {v: ["a"]}`)).toEqual([
      "E0201",
    ]);
  });

  it("checks a nested instantiation", () => {
    expect(
      appCodes(
        `type Box(T) = {v: T}\ntype Pair(A) = {l: Box(A), r: Box(A)}\nslot p : Pair(Int) = {l: {v: 1}, r: {v: "x"}}`,
      ),
    ).toEqual(["E0201"]);
  });

  it("accepts a correct instantiation", () => {
    expect(appCodes(`type Box(T) = {v: T}\nslot b : Box(Int) = {v: 1}`)).toEqual([]);
  });

  it("reports a generic named without its arguments", () => {
    expect(appCodes(`type Box(T) = {v: T}\nslot b : Box = {v: 1}`)).toEqual(["E0210"]);
  });
});
