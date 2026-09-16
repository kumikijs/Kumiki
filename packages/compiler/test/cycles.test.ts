// Three definitions that are defined in terms of themselves, and what each one
// used to do instead of reporting.
//
// A tile cycle crashed `codegen` with a bare `RangeError` and no position — the
// tile walk inlines every child, so a cycle is an infinite tree. A slot
// initializer that reads another slot broke the mounted app with
// `ReferenceError: Cannot access '_live' before initialization`, cycle or not:
// the lowered read names `_live`, which is declared after the slot table. A
// recursive `fn` ran fine but is prohibited by the language.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const diags = (src: string) => check(parse(lex(src)));
const codes = (src: string) => diags(src).map((e) => e.code);

describe("a tile that expands into itself", () => {
  it("reports direct self-expansion and names the path", () => {
    const src = `tile App = column(text("a"), App)
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0005");
    expect(err?.message).toContain("App → App");
  });

  it("reports mutual expansion", () => {
    const src = `tile A = column(text("a"), B)
tile B = column(text("b"), A)
tile App = column(A)
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0005");
    expect(err?.message).toContain("A → B → A");
  });

  // Every position is pinned exactly. A loop's message names one definition
  // and its position must land in that definition — the two are pinned
  // together, because a message and a position that disagree send the reader
  // to the wrong file.
  const positions: [string, string, string][] = [
    [
      "a mutual loop, at the first edge",
      `tile A = column(text("a"), B)
tile B = column(text("b"), A)
tile App = column(A)`,
      // A's reference to B, not B's closing reference to A: the latter would
      // name one tile and point at another.
      "1:28",
    ],
    [
      "a three-tile loop, at the first edge",
      `tile A = column(B)
tile B = column(C)
tile C = column(A)
tile App = column(A)`,
      "1:17",
    ],
    [
      // The only shape that reads the fallback in `frames[depth + 1]?.…`:
      // a self-loop has no second frame to have been entered by.
      "a self-loop, at its own back edge",
      `tile App = column(text("a"), App)`,
      "1:30",
    ],
    [
      "a loop closed by an error-boundary, at the boundary clause",
      `tile A error-boundary=B = column(text("a"))
tile B = column(text("b"), A())
tile App = column(A())`,
      "1:23",
    ],
  ];
  for (const [what, defs, at] of positions) {
    it(`points at ${what}`, () => {
      const err = diags(`${defs}\n${TAIL}`)[0];
      expect(err?.code).toBe("E0005");
      expect(`${err?.pos.line}:${err?.pos.col}`).toBe(at);
    });
  }

  it("reports a cycle once however many tiles lead into it", () => {
    const src = `tile A = column(B)
tile B = column(A)
tile C = column(A)
tile D = column(B)
tile App = column(C, D)
${TAIL}`;
    expect(codes(src)).toEqual(["E0005"]);
  });

  it("reports a cycle once however many edges close it", () => {
    // `column(A, A)` takes the same back edge twice, and
    // `if c then column(A) else column(A)` is the everyday form of it.
    expect(
      codes(`tile A = column(B)\ntile B = column(A, A)\ntile App = column(A)\n${TAIL}`),
    ).toEqual(["E0005"]);
    expect(
      codes(
        `tile A = column(B)
tile B = if true then column(A) else column(A)
tile App = column(A)
${TAIL}`,
      ),
    ).toEqual(["E0005"]);
  });

  it("reports two loops through one tile separately", () => {
    // `A → B → A` and `A → C → A` share their entry point but are distinct
    // findings — deduplicating by the tile they pass through would lose one.
    expect(
      codes(
        `tile A = column(B, C)
tile B = column(A)
tile C = column(A)
tile App = column(A)
${TAIL}`,
      ),
    ).toEqual(["E0005", "E0005"]);
  });

  it("reports two independent cycles separately", () => {
    const src = `tile A = column(B)
tile B = column(A)
tile C = column(D)
tile D = column(C)
tile App = column(A, C)
${TAIL}`;
    expect(codes(src)).toEqual(["E0005", "E0005"]);
  });

  it("follows a bare identifier standing in for a tile", () => {
    // A capitalised name inside a builtin parses as a `TileCall`; a lowercase
    // one parses as a `Ref`. Code generation resolves that `Ref` to a tile
    // before anything else and inlines it the same way — which is what made
    // this shape crash the build — while the checker resolves it as a value.
    // So the slots are what makes the program reach code generation at all:
    // without them the names are E0103 and there is nothing to inline.
    const src = `slot leaf : Int = 1
slot other : Int = 2
tile leaf = column(text("l"), other)
tile other = column(text("o"), leaf)
tile App = column(leaf)
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0005");
    expect(err?.message).toContain("leaf → other → leaf");
  });

  // Each of these is a construct codegen inlines, so each is an expansion edge.
  const nesting: [string, string][] = [
    ["a nested call", `tile A = column(row(B))`],
    ["a call with arguments", `tile A = column(B())`],
    ["a when branch", `tile A = column(when(true, B))`],
    ["an if branch", `tile A = if true then column(B) else column(text("x"))`],
    ["an else branch", `tile A = if true then column(text("x")) else column(B)`],
    ["a for body", `tile A = for i in [1] column(B)`],
    [
      "a match arm",
      `slot o : Option(Int) = None
tile A = match o with | Some(n) -> column(B) | None -> column(text("x"))`,
    ],
  ];
  for (const [what, tileA] of nesting) {
    it(`follows the cycle through ${what}`, () => {
      expect(codes(`${tileA}\ntile B = column(A)\ntile App = column(A)\n${TAIL}`)).toEqual([
        "E0005",
      ]);
    });
  }

  it("resolves a name a program redeclares to that program's tile", () => {
    // `tile column = column(…)` shadows a builtin. The checker resolves both
    // occurrences to the declaration, so the body is read as calling itself —
    // which is also how `checkTileInput` reads it, hence the arity reports.
    // Pinned because the alternative reading (inner name = the builtin) would
    // make this legal, and the two cannot both be right.
    expect(
      codes(`tile column = column(text("x"))
tile App = column(text("y"))
${TAIL}`),
    ).toEqual(["E0213", "E0213", "E0005"]);
  });

  it("does not follow sub-routes", () => {
    // A sub-route is resolved by the router at runtime through `route-outlet`,
    // not inlined — mutual sub-routes build and run today.
    const src = `tile NotFound = page(heading("404"))
tile Inner sub-routes = { "/b/x" -> Outer } = page(heading("inner"), route-outlet())
tile Outer sub-routes = { "/a/x" -> Inner } = page(heading("outer"), route-outlet())
app SubCycle caps=[] routes={"/a/*" -> Outer, "/b/*" -> Inner, "/404" -> NotFound} init=[]
`;
    expect(codes(src)).toEqual([]);
  });

  it("follows error-boundary", () => {
    // The boundary's body is inlined into the `catch` at every call site of
    // the tile that declares it, so a boundary that leads back is a cycle
    // like any other. Reached through a call rather than a bare identifier
    // because only the call site emits the wrapper.
    const src = `tile A error-boundary=B = column(text("a"))
tile B = column(text("b"), A())
tile App = column(A())
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0005");
    expect(err?.message).toContain("A → B → A");
  });

  it("does not follow a tile passed as a named argument, which nothing renders", () => {
    // This used to be an expansion edge because a user tile took its first
    // argument by name or by position alike and inlined a tile-valued one.
    // It takes the positional one now, a builtin container skips named
    // arguments, and the builtins that read one by name all want a value — so
    // no tile written as a named argument is rendered anywhere, and there is
    // no loop here to close. The shape is reported for what it is instead.
    const src = `tile Wrap = column(text("w"))
tile App = column(Wrap(c=when(true, App())))
${TAIL}`;
    expect(codes(src)).toEqual(["E0201"]);
  });

  it("leaves an acyclic chain alone", () => {
    const src = `tile C = column(text("c"))
tile B = column(C)
tile A = column(B, C)
tile App = column(A)
${TAIL}`;
    expect(codes(src)).toEqual([]);
  });
});

describe("a slot initializer that reads a slot", () => {
  it("reports the read, at the read itself", () => {
    const src = `slot b : Int = 1
slot a : Int = b + 1
tile App = column(text(a.show))
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0304");
    expect(err?.message).toContain(`slot "b"`);
    // The identifier, not the definition: the fix is at the read.
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe("2:16");
  });

  // Every position a slot read can occupy in an initializer. Each of these
  // lowers to the same `_live[...]` lookup and would throw on mount.
  const readSites: [string, string][] = [
    ["an operand", `slot a : Int = b + 1`],
    ["a method receiver", `slot a : Text = b.show`],
    ["a call argument", `slot a : Text = [b].show`],
    ["a record field", `slot a : Int = {x: b}.x`],
    ["a lambda body", `slot a : List(Int) = [1, 2].map($1 + b)`],
    ["a list element", `slot a : List(Int) = [b, 1]`],
    ["an if branch", `slot a : Int = if true then b else 0`],
  ];
  for (const [where, decl] of readSites) {
    it(`reports a slot read in ${where}`, () => {
      expect(
        codes(`slot b : Int = 1
${decl}
tile App = column(text("x"))
${TAIL}`),
      ).toEqual(["E0304"]);
    });
  }

  it("reports it in the other declaration order too", () => {
    // The lowered read names `_live`, which does not exist while the slot
    // table is being built — so declaring the dependency first fixes nothing.
    const src = `slot a : Int = b + 1
slot b : Int = 1
tile App = column(text(a.show))
${TAIL}`;
    expect(codes(src)).toEqual(["E0304"]);
  });

  it("reports a slot that reads itself", () => {
    const src = `slot a : Int = a + 1
tile App = column(text(a.show))
${TAIL}`;
    expect(codes(src)).toEqual(["E0304"]);
  });

  it("does not report a local binding that shadows a slot name", () => {
    const src = `slot b : Int = 1
slot a : Int = let b = 2 in b + 1
tile App = column(text(a.show))
${TAIL}`;
    expect(codes(src)).toEqual([]);
  });

  it("does not report a fn call", () => {
    const src = `fn double(n: Int) -> Int = n * 2
slot a : Int = double(21)
tile App = column(text(a.show))
${TAIL}`;
    expect(codes(src)).toEqual([]);
  });

  it("does not report a literal initializer", () => {
    const src = `slot a : Int = 1
slot b : Text = "x"
slot c : List(Int) = [1, 2]
tile App = column(text(a.show))
${TAIL}`;
    expect(codes(src)).toEqual([]);
  });
});

describe("a fn that calls itself", () => {
  it("reports direct recursion and names the path", () => {
    const src = `fn fact(n: Int) -> Int = if n <= 1 then 1 else n * fact(n - 1)
tile App = column(text(fact(5).show))
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0006");
    expect(err?.message).toContain("fact → fact");
    // The recursive call, not the definition.
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe("1:52");
  });

  it("points at the first call of a longer loop", () => {
    const src = `fn f(n: Int) -> Int = g(n)
fn g(n: Int) -> Int = h(n)
fn h(n: Int) -> Int = f(n)
tile App = column(text("x"))
${TAIL}`;
    const err = diags(src)[0];
    expect(err?.message).toContain("f → g → h → f");
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe("1:23");
  });

  it("reports mutual recursion once", () => {
    const src = `fn even(n: Int) -> Bool = if n == 0 then true else odd(n - 1)
fn odd(n: Int) -> Bool = if n == 0 then false else even(n - 1)
tile App = column(text("x"))
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0006");
    expect(err?.message).toContain("even → odd → even");
  });

  it("leaves an acyclic call chain alone", () => {
    const src = `fn triple(n: Int) -> Int = n * 3
fn nine(n: Int) -> Int = triple(triple(n))
tile App = column(text(nine(1).show))
${TAIL}`;
    expect(codes(src)).toEqual([]);
  });

  it("does not confuse a parameter that shadows a fn name for a call", () => {
    const src = `fn twice(n: Int) -> Int = n * 2
fn use(twice: Int) -> Int = twice + 1
tile App = column(text(use(1).show))
${TAIL}`;
    expect(codes(src)).toEqual([]);
  });
});

describe("a type that resolves to itself", () => {
  // The two cycle codes above are about definitions with bodies to run. A
  // `type` has no body to reach at all when its alias chain comes back to a
  // name already on it, so a slot declared with one silently got no type and
  // every value-level check on it went quiet — the same silence a misspelled
  // type name produced before E0117.
  const TILE = `tile App = column(text("x"))\n`;
  const typeDiags = (defs: string) => diags(`${defs}\n${TILE}${TAIL}`);
  const typeCodes = (defs: string) => typeDiags(defs).map((e) => e.code);

  it("reports a type whose body is its own name", () => {
    const [err, ...rest] = typeDiags(`type A = A\nslot x : A = 1`);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0009");
    expect(err?.kind).toBe("type-cycle");
    expect(err?.message).toContain("A → A");
    // The reference in the body, which is the name to change.
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe("1:10");
  });

  it("reports a mutual alias, at the first edge", () => {
    const [err, ...rest] = typeDiags(`type A = B\ntype B = A\nslot x : A = 1`);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0009");
    expect(err?.message).toContain("A → B → A");
    // A's reference to B, not B's closing reference to A — as for E0005, the
    // message and the position have to name the same definition.
    expect(`${err?.pos.line}:${err?.pos.col}`).toBe("1:10");
  });

  it("reports a three-type loop", () => {
    const [err, ...rest] = typeDiags(`type A = B\ntype B = C\ntype C = A\nslot x : A = 1`);
    expect(rest).toEqual([]);
    expect(err?.message).toContain("A → B → C → A");
  });

  // Every wrapper the chain passes through on its way to the next name. Each
  // is a node `unaliasType` steps over rather than stopping at, so each hides
  // a loop that has no more meaning than the bare one.
  const wrappers: [string, string][] = [
    ["nominal", `type A = nominal B\ntype B = nominal A`],
    ["a refinement", `type A = B where positive\ntype B = A`],
    ["nominal with a refinement", `type A = nominal B where positive\ntype B = A`],
  ];
  for (const [what, defs] of wrappers) {
    it(`follows the chain through ${what}`, () => {
      expect(typeCodes(`${defs}\nslot x : A = 1`)).toEqual(["E0009"]);
    });
  }

  it("follows a generic named with its arguments", () => {
    // `unaliasType` expands a `TypeApp` whose name has a definition, so the
    // application is an alias step like a bare name is.
    expect(typeCodes(`type A = B(Int)\ntype B(T) = A\nslot x : A = 1`)).toEqual(["E0009"]);
  });

  it("reports a cycle once however many types lead into it", () => {
    expect(
      typeCodes(`type A = B
type B = A
type C = A
type D = B
slot x : C = 1
slot y : D = 2`),
    ).toEqual(["E0009"]);
  });

  it("reports two independent cycles separately", () => {
    expect(
      typeCodes(`type A = B
type B = A
type C = D
type D = C
slot x : A = 1
slot y : C = 2`),
    ).toEqual(["E0009", "E0009"]);
  });

  it("reports a cycle no other definition names", () => {
    // A type nothing uses is still a definition with no meaning, and the tile
    // and fn passes report an unused cycle the same way.
    expect(typeCodes(`type A = A`)).toEqual(["E0009"]);
  });

  // A structural node is where normalisation stops, so the name inside one is
  // reached through a value that exists — this is the co-inductive reading
  // `assignable.ts#relate` is written against, and it must stay legal.
  const recursive: [string, string][] = [
    ["a record naming itself", `type Node = {value: Int, next: Node}`],
    ["a record reaching itself through a container", `type Tree = {children: List(Tree)}`],
    ["two records naming each other", `type A = {b: B}\ntype B = {a: A}`],
    ["a union naming itself", `type T = Leaf | Branch(T, T)`],
    ["an alias through a container", `type A = Option(A)`],
    ["an alias whose chain ends in a record", `type A = {v: B}\ntype B = A`],
    ["an alias chain that ends in a primitive", `type A = Int\ntype B = A`],
  ];
  for (const [what, defs] of recursive) {
    it(`leaves ${what} alone`, () => {
      expect(typeCodes(defs)).toEqual([]);
    });
  }

  it("does not read a parameter that shadows a type name as an edge", () => {
    // `type Alias(Cents) = Cents` resolves to its argument, not to the global
    // of that spelling — the reason `nominalDecl` substitutes before it walks.
    expect(
      typeCodes(`type Cents = nominal Int where positive
type Alias(Cents) = Cents
slot c : Alias(Int) = 1`),
    ).toEqual([]);
  });

  it("does not read an unresolvable name as an edge", () => {
    // `Nope` names nothing, so there is no chain to come back along — E0117
    // is what reports it, and reporting a cycle as well would be two names
    // for one mistake.
    expect(typeCodes(`type A = Nope\nslot x : A = 1`)).toEqual(["E0117"]);
  });

  it("does not silence the rest of the check", () => {
    // The cycle makes its own type meaningless; every other definition is
    // still checked against the types it does have.
    expect(typeCodes(`type A = A\nslot x : A = 1\nslot n : Int = "x"`)).toEqual(["E0201", "E0009"]);
  });
});
