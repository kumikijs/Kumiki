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

  it("points inside the definition its message names", () => {
    const src = `tile A = column(text("a"), B)
tile B = column(text("b"), A)
tile App = column(A)
${TAIL}`;
    const err = diags(src)[0];
    // `A → B → A` starts at A's reference to B, which is on line 1 — not at
    // B's closing reference on line 2, which would name one tile and point at
    // another.
    expect(err?.pos.line).toBe(1);
  });

  it("reports a cycle once however many tiles lead into it", () => {
    const src = `tile A = column(B)
tile B = column(A)
tile C = column(A)
tile D = column(B)
tile App = column(C, D)
${TAIL}`;
    expect(codes(src)).toEqual(["E0005"]);
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

  it("does not follow error-boundary", () => {
    // The boundary tile is emitted where the tile is mounted as a route root;
    // an inlined child does not re-apply it, so this is not an expansion edge.
    const src = `tile A error-boundary=B = column(text("a"))
tile B = column(text("b"), A)
tile App = column(A)
${TAIL}`;
    expect(codes(src)).toEqual([]);
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
  it("reports the read", () => {
    const src = `slot b : Int = 1
slot a : Int = b + 1
tile App = column(text(a.show))
${TAIL}`;
    const [err, ...rest] = diags(src);
    expect(rest).toEqual([]);
    expect(err?.code).toBe("E0304");
    expect(err?.message).toContain(`slot "b"`);
  });

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
