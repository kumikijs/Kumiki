import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { REENTRY_LIMIT } from "../src/assignable.ts";
import { summariesOf } from "./helpers/diagnostics.ts";
import { withRoot } from "./helpers/programs.ts";

const G = "type G(T) = Leaf(T) | Node(G(List(T)))";

const DEADLINE_MS = 5000;

// `check` is synchronous, so a test timeout cannot stop one that never returns; `vm`'s timeout
// interrupts the call, and a comparison that does not end fails its own test.
function diags(defs: string): string[] {
  const src = withRoot('text("x")', defs);
  try {
    return runInNewContext("run()", { run: () => summariesOf(src) }, { timeout: DEADLINE_MS });
  } catch (e) {
    // The context's realm makes the timeout error, so it is no `Error` of this one.
    if (typeof e === "object" && e !== null && "code" in e) {
      if (e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        throw new Error(`check did not finish within ${DEADLINE_MS} ms`);
      }
    }
    throw e;
  }
}

/** A program whose one reducer performs `write` on a click. */
const writing = (decls: string, write: string) =>
  `${decls}
reducer w on=ui.click(B) do= ${write}
tile B = button(text="b", onClick=w)`;

/** A record of `n` fields typed `each`, then a field `g` typed `last`. */
const record = (name: string, n: number, each: string, last: string) =>
  `type ${name} = {${Array.from({ length: n }, (_, i) => `f${i}: ${each}`).join(", ")}, g: ${last}}`;

type Case = [what: string, defs: string, expected: string[]];

const run = (cases: Case[]) =>
  it.each(cases)("%s", (_, defs, expected) => {
    expect(diags(defs)).toEqual(expected);
  });

describe("a generic whose argument grows at each level", () => {
  run([
    [
      "passes a value through a fn typed G(Int) -> G(Int)",
      `${G}\nfn same(g: G(Int)) -> G(Int) = g`,
      [],
    ],
    [
      "writes one G(Int) slot into another",
      writing(`${G}\nslot x : G(Int) = Leaf(3)\nslot y : G(Int) = Leaf(4)`, "x := y"),
      [],
    ],
    [
      "refuses an Int written into a G(Int) slot",
      writing(`${G}\nslot x : G(Int) = Leaf(3)`, "x := 5"),
      ["E0201 Expected G(Int) but got Int"],
    ],
    [
      "refuses a G(Text) written into a G(Int) slot",
      writing(`${G}\nslot x : G(Int) = Leaf(3)\nslot y : G(Text) = Leaf("a")`, "x := y"),
      ["E0201 Expected G(Int) but got G(Text)"],
    ],
    [
      "refuses G(Int) where G(Text) is required",
      `${G}\nfn f(g: G(Int)) -> G(Text) = g`,
      ["E0201 Expected G(Text) but got G(Int)"],
    ],
    ["accepts G(Int) where G(Float) is required", `${G}\nfn f(g: G(Int)) -> G(Float) = g`, []],
    [
      "refuses G(Float) where G(Int) is required",
      `${G}\nfn f(g: G(Float)) -> G(Int) = g`,
      ["E0201 Expected G(Int) but got G(Float)"],
    ],
    [
      "compares it inside a List, an Option and a record field",
      `${G}
type R = {g: G(Int), n: Int}
fn a(g: List(G(Int))) -> List(G(Int)) = g
fn b(g: Option(G(Int))) -> Option(G(Int)) = g
fn c(r: R) -> R = r
fn d(r: R) -> G(Int) = r.g`,
      [],
    ],
    [
      "compares it under an alias",
      `${G}
type GI = G(Int)
fn a(g: GI) -> G(Int) = g
fn b(g: G(Int)) -> GI = g
fn c(g: GI) -> G(Text) = g`,
      ["E0201 Expected G(Text) but got GI"],
    ],
    [
      "compares it under a nominal",
      `${G}
type NG  = nominal G(Int)
type NG2 = nominal G(Int)
fn a(g: NG) -> G(Int) = g
fn b(g: G(Int)) -> NG = g
fn c(g: NG) -> NG2 = g`,
      ["E0201 Expected NG2 but got NG"],
    ],
    [
      "tries the growing variant first",
      `type G(T) = Node(G(List(T))) | Leaf(T)
fn a(g: G(Int)) -> G(Int) = g
fn b(g: G(Int)) -> G(Text) = g`,
      ["E0201 Expected G(Text) but got G(Int)"],
    ],
    [
      "grows its argument two ways at each level",
      `type B(T) = BLeaf(T) | BNode(B(List(T)), B(Option(T)))
fn a(b: B(Int)) -> B(Int) = b
fn c(b: B(Int)) -> B(Text) = b`,
      ["E0201 Expected B(Text) but got B(Int)"],
    ],
    [
      "grows it through a record",
      `type R(T) = {v: T, next: Option(R(List(T)))}
fn a(r: R(Int)) -> R(Int) = r
fn b(r: R(Int)) -> R(Text) = r`,
      ["E0201 Expected R(Text) but got R(Int)"],
    ],
    [
      "grows it through two generics that name each other",
      `type MA(T) = NilA | ConsA(T, MB(List(T)))
type MB(T) = NilB | ConsB(MA(Option(T)))
fn a(m: MA(Int)) -> MA(Int) = m
fn b(m: MB(Int)) -> MB(Int) = m
fn c(m: MA(Int)) -> MA(Text) = m`,
      ["E0201 Expected MA(Text) but got MA(Int)"],
    ],
  ]);
});

describe("an argument is compared the way unfolding compares it", () => {
  const nominals = `type Tagged(U) = nominal U
type Yen   = nominal Int
type Cents = nominal Int`;
  run([
    [
      "is ignored when the parameter is only passed back into the recursion",
      `type Q(T) = QLeaf | QNode(Q(List(T)))
fn a(q: Q(Int)) -> Q(Int) = q
fn b(q: Q(Int)) -> Q(Text) = q`,
      [],
    ],
    [
      "is ignored beside a parameter that is compared",
      `type K(T, U) = KLeaf(T) | KNode(K(List(T), U))
fn a(k: K(Int, Int)) -> K(Int, Text) = k
fn b(k: K(Int, Int)) -> K(Text, Int) = k`,
      ["E0201 Expected K(Text, Int) but got K(Int, Int)"],
    ],
    [
      "is compared past its nominal while a nominal generic wraps it at every level",
      `${nominals}
type W(T) = WLeaf | WNode(Tagged(T), W(Tagged(T)))
fn a(w: W(Yen)) -> W(Cents) = w
fn b(w: W(Int)) -> W(Text) = w`,
      ["E0201 Expected W(Text) but got W(Int)"],
    ],
    [
      "is compared with its nominal once a container holds it",
      `${nominals}
type W(T) = WLeaf | WNode(Tagged(T), W(List(T)))
fn a(w: W(Yen)) -> W(Cents) = w
fn b(w: W(Int)) -> W(Text) = w`,
      ["E0201 Expected W(Cents) but got W(Yen)", "E0201 Expected W(Text) but got W(Int)"],
    ],
    [
      "is compared with its nominal when a record holds it",
      `${nominals}
type Rec(T) = {v: T}
fn a(r: Rec(Yen)) -> Rec(Cents) = r`,
      ["E0201 Expected Rec(Cents) but got Rec(Yen)"],
    ],
    [
      "is compared with its nominal when the generic hands it straight back, beside one it ignores",
      `${nominals}
type Fst(T, U) = T
fn a(f: Fst(Int, Int)) -> Fst(Int, Text) = f
fn b(f: Fst(Yen, Int)) -> Fst(Cents, Int) = f`,
      ["E0201 Expected Fst(Cents, Int) but got Fst(Yen, Int)"],
    ],
  ]);
});

// Two different generics are unfolded rather than compared argument by argument, and a pair of heads
// that applies a growing generic stops after a bounded number of re-entries that grew.
describe("two different generics that both grow", () => {
  const H = "type H(T) = Leaf(T) | Node(H(Option(T)))";
  run([
    [
      "accepts one where the other is required",
      `${G}
type H(T) = Leaf(T) | Node(H(List(T)))
fn a(g: G(Int)) -> H(Int) = g
fn b(g: G(Int)) -> H(Text) = g`,
      ["E0201 Expected H(Text) but got G(Int)"],
    ],
    [
      "accepts one where the other is required when both grow two ways",
      `type A(T) = L(T) | N(A(List(T)), A(Option(T)))
type B(T) = L(T) | N(B(List(T)), B(Option(T)))
fn a(x: A(Int)) -> B(Int) = x`,
      [],
    ],
    [
      "accepts one where the other is required when they name each other",
      `type MA(T) = Nil | Cons(T, MB(List(T)))
type MB(T) = Nil | Cons(T, MA(List(T)))
fn a(m: MA(Int)) -> MB(Int) = m
fn b(m: MA(Int)) -> MB(Text) = m`,
      ["E0201 Expected MB(Text) but got MA(Int)"],
    ],
    [
      "finds a mismatch one level down",
      `${G}\n${H}\nfn g(x: G(Int)) -> H(Int) = x`,
      ["E0201 Expected H(Int) but got G(Int)"],
    ],
    [
      "finds a mismatch in a field after a field of one growing generic",
      `${G}
${H}
type R1 = {a: G(Int), b: G(Int)}
type R2 = {a: G(Int), b: H(Int)}
fn f(r: R1) -> R2 = r`,
      ["E0201 Expected R2 but got R1"],
    ],
    [
      "accepts a growing generic where one that does not grow is required, and back",
      `type G2(T) = Leaf(Int) | Node(G2(List(T)))
type J(T)  = Leaf(Int) | Node(J(T))
fn a(x: G2(Int)) -> J(Int) = x
fn b(x: J(Int)) -> G2(Int) = x`,
      [],
    ],
    [
      "counts each pair of heads on its own, so one that spends its count hides nothing in another",
      `type G(T)  = Leaf(T) | Node(G(List(T)))
type H(T)  = Leaf(T) | Node(H(List(T)))
type H2(T) = Leaf(T) | Node(H2(Set(T)))
type R1 = {a: G(Int), b: G(Int)}
type R2 = {a: H(Int), b: H2(Int)}
type R3 = {b: G(Int), a: G(Int)}
type R4 = {b: H2(Int), a: H(Int)}
fn f(r: R1) -> R2 = r
fn g(r: R3) -> R4 = r`,
      ["E0201 Expected R2 but got R1", "E0201 Expected R4 but got R3"],
    ],
    // The bound is per pair of heads and per comparison, so the order of the fields decides here:
    // `a` grows forever and spends the count of G ⇒ H, and b's mismatch is one re-entry down.
    [
      "answers yes to a mismatch in the same pair of heads once an earlier field spent the count",
      `type G(T, U) = Leaf(T) | Node(G(List(U), U)) | Grow(G(T, List(U)))
type H(T, U) = Leaf(T) | Node(H(List(U), U)) | Grow(H(T, List(U)))
type R1 = {a: G(Int, Int), b: G(Int, Int)}
type R2 = {a: H(Int, Int), b: H(Int, Text)}
type R3 = {b: G(Int, Int), a: G(Int, Int)}
type R4 = {b: H(Int, Text), a: H(Int, Int)}
fn f(r: R1) -> R2 = r
fn g(r: R3) -> R4 = r`,
      ["E0201 Expected R4 but got R3"],
    ],
  ]);
});

describe("the bound on re-entries that grew", () => {
  // Each level hands every parameter one place down and the first one, in a `List`, to the last,
  // so the comparison re-enters with a larger type each time and compares parameter k at the k-th.
  const n = REENTRY_LIMIT + 2;
  const params = Array.from({ length: n }, (_, i) => `P${i}`);
  const shift = (name: string) =>
    `type ${name}(${params.join(", ")}) = Leaf(P0) | Node(${name}(${params.slice(1).join(", ")}, List(P0)))`;
  /** Every argument `Int`, except a `Text` at `textAt`. */
  const args = (textAt?: number) =>
    params.map((_, i) => (i === textAt ? "Text" : "Int")).join(", ");
  const defs = `${shift("R")}\n${shift("S")}`;
  // A rotation re-enters at the same size, and only a re-entry that grew counts: with every argument
  // a nominal of its own, the rotations are new pairs as written until the last parameter is first.
  const rotate = (name: string) =>
    `type ${name}(${params.join(", ")}) = Leaf(P0) | Turn(${name}(${params.slice(1).join(", ")}, P0)) | Grow(${name}(List(P0), ${params.slice(1).join(", ")}))`;
  const nominals = params.map((_, i) => `type N${i} = nominal Int`).join("\n");
  const named = (textAt?: number) =>
    params.map((_, i) => (i === textAt ? "Text" : `N${i}`)).join(", ");
  run([
    [
      "finds a mismatch at the last re-entry it counts",
      `${defs}\nfn a(x: R(${args()})) -> S(${args(REENTRY_LIMIT)}) = x`,
      [`E0201 Expected S(${args(REENTRY_LIMIT)}) but got R(${args()})`],
    ],
    [
      "answers yes at the re-entry after it",
      `${defs}\nfn a(x: R(${args()})) -> S(${args(REENTRY_LIMIT + 1)}) = x`,
      [],
    ],
    [
      "does not bound two applications of one generic, which are compared by their arguments",
      `${defs}\nfn a(x: R(${args()})) -> R(${args(REENTRY_LIMIT + 1)}) = x`,
      [`E0201 Expected R(${args(REENTRY_LIMIT + 1)}) but got R(${args()})`],
    ],
    [
      "does not count a re-entry that did not grow",
      `${rotate("R")}\n${rotate("S")}\n${nominals}
fn a(x: R(${named()})) -> S(${named(REENTRY_LIMIT + 1)}) = x`,
      [`E0201 Expected S(${named(REENTRY_LIMIT + 1)}) but got R(${named()})`],
    ],
  ]);
});

// More fields than one pair of heads may re-enter, so charging a generic that only swaps its
// parameters would accept the last field.
describe("a generic that swaps its parameters still finds a mismatch in the last of many fields", () => {
  const fields = REENTRY_LIMIT + 1;
  run([
    [
      "one generic",
      `type Sw(T, U) = SwLeaf(T) | SwNode(Sw(U, T))
${record("R1", fields, "Sw(Int, Text)", "Sw(Int, Text)")}
${record("R2", fields, "Sw(Int, Text)", "Sw(Int, Int)")}
fn f(r: R1) -> R2 = r`,
      ["E0201 Expected R2 but got R1"],
    ],
    [
      "two generics",
      `type SA(T, U) = SLeaf(T) | SNode(SA(U, T))
type SB(T, U) = SLeaf(T) | SNode(SB(U, T))
${record("R1", fields, "SA(Int, Text)", "SA(Int, Text)")}
${record("R2", fields, "SB(Int, Text)", "SB(Int, Int)")}
fn f(r: R1) -> R2 = r`,
      ["E0201 Expected R2 but got R1"],
    ],
  ]);
});

// Two different regular generics are unfolded to the end, however many comparisons come first:
// each pair below re-enters once or more with a larger type before it repeats.
describe("two different regular generics are unfolded to the end", () => {
  const W = `type W(T) = WL(T) | WN(W(Option(Int)))
type X(T) = WL(T) | WN(X(Option(Int)))
type Y(T) = WL(T) | WN(Y(Option(Text)))`;
  const eights = "Int, Int, Int, Int, Int, Int, Int, Int";
  const shifts = `type R(A, B, C, D, E, F, G, H) = Leaf(A) | Node(R(B, C, D, E, F, G, H, Option(Int)))
type S(A, B, C, D, E, F, G, H) = Leaf(A) | Node(S(B, C, D, E, F, G, H, Option(Int)))`;
  // Eight fields of eight re-entries each are as many as one pair of heads may make.
  const shifted = (head: string, n: number) =>
    Array.from({ length: n }, (_, i) => `f${i}: ${head}(${eights})`).join(", ");
  const XY = `${shifts}
type R2(T) = Leaf2(T) | Node2(R2(Option(Int)))
type S2(T) = Leaf2(T) | Node2(S2(Option(Text)))
type X = {${shifted("R", 8)}, z: R2(Int)}
type Y = {${shifted("S", 8)}, z: S2(Int)}`;
  run([
    [
      "in the last of as many fields as the bound counts",
      `${W}
${record("R1", REENTRY_LIMIT, "W(Int)", "W(Int)")}
${record("R2", REENTRY_LIMIT, "X(Int)", "Y(Int)")}
fn f(r: R1) -> R2 = r`,
      ["E0201 Expected R2 but got R1"],
    ],
    [
      "in the last of as many union variants as the bound counts",
      `${W}
type U1 = ${Array.from({ length: REENTRY_LIMIT }, (_, i) => `V${i}(W(Int))`).join(" | ")} | Vz(W(Int))
type U2 = ${Array.from({ length: REENTRY_LIMIT }, (_, i) => `V${i}(X(Int))`).join(" | ")} | Vz(Y(Int))
fn f(u: U1) -> U2 = u`,
      ["E0201 Expected U2 but got U1"],
    ],
    [
      "that shift their parameters, in the last of eight fields",
      `${shifts}
type T8 = {${shifted("R", 8)}, g: R(${eights})}
type U8 = {${shifted("S", 8)}, g: S(Int, Int, Int, Int, Int, Int, Int, Text)}
fn f(r: T8) -> U8 = r`,
      ["E0201 Expected U8 but got T8"],
    ],
    [
      "in a list literal",
      `${XY}\nfn h(x: X, y: Y) -> List(X) = [y, x]`,
      ["E0201 Expected X but got Y"],
    ],
    [
      "where an if joins two types that have no common type",
      `${XY}
fn need(r: R2(Int)) -> Int = 0
fn h(c: Bool, x: X, y: Y) -> Int = need((if c then y else x).z)`,
      [],
    ],
  ]);
});

describe("regular generics are compared as unfolding compares them", () => {
  run([
    [
      "the recursive types of language.md",
      `type Node  = {value: Int, next: Node}
type Tree  = {children: List(Tree)}
type Shape = Leaf | Branch(Shape, Shape)
fn a(x: Node) -> Node = x
fn b(x: Tree) -> Tree = x
fn c(x: Shape) -> Shape = x
fn d(x: Tree) -> Shape = x
fn e(x: Shape) -> Tree = x
fn f(x: Node) -> Tree = x`,
      [
        "E0201 Expected Shape but got Tree",
        "E0201 Expected Tree but got Shape",
        "E0201 Expected Tree but got Node",
      ],
    ],
    [
      "a container generic",
      `type Box(T) = Empty | Full(T)
fn a(b: Box(Int)) -> Box(Text) = b
fn b(b: Box(Int)) -> Box(Int) = b
fn c(b: Box(Int)) -> Box(Float) = b`,
      ["E0201 Expected Box(Text) but got Box(Int)"],
    ],
    [
      "a recursive generic",
      `type Tree(T) = TLeaf | TNode(Tree(T), T, Tree(T))
fn a(t: Tree(Int)) -> Tree(Int) = t
fn b(t: Tree(Int)) -> Tree(Text) = t
fn c(t: Tree(Int)) -> Tree(Float) = t
fn d(t: Tree(Float)) -> Tree(Int) = t`,
      [
        "E0201 Expected Tree(Text) but got Tree(Int)",
        "E0201 Expected Tree(Int) but got Tree(Float)",
      ],
    ],
    [
      "a generic that swaps its parameters at each level",
      `type Sw(T, U) = SwLeaf(T) | SwNode(Sw(U, T))
fn a(s: Sw(Int, Int)) -> Sw(Int, Text) = s
fn b(s: Sw(Int, Text)) -> Sw(Int, Text) = s`,
      ["E0201 Expected Sw(Int, Text) but got Sw(Int, Int)"],
    ],
    [
      "a parameter the body never names",
      `type P(T) = PNone | PSome(Int)
fn a(p: P(Int)) -> P(Text) = p`,
      [],
    ],
    [
      "a parameter named only where it is passed back into the recursion",
      `type S(T) = SLeaf | SNode(S(T))
fn a(s: S(Int)) -> S(Text) = s`,
      [],
    ],
    [
      "a parameter named only as the argument of a generic that ignores it",
      `type Ph(X) = PhA | PhB
type R(T)  = RLeaf(Int) | RNode(Ph(T), R(T))
fn a(r: R(Int)) -> R(Text) = r`,
      [],
    ],
    [
      "a nominal generic that ignores its parameter",
      `type Id(T) = nominal Text
type U1 = {name: Text}
type U2 = {title: Text}
fn a(i: Id(U1)) -> Id(U2) = i`,
      [],
    ],
    [
      "a nominal generic over its parameter, compared past the argument's nominal",
      `type Tagged(U) = nominal U
type Yen   = nominal Int
type Cents = nominal Int
fn a(t: Tagged(Yen)) -> Tagged(Cents) = t
fn b(t: Tagged(Int)) -> Tagged(Text) = t`,
      ["E0201 Expected Tagged(Text) but got Tagged(Int)"],
    ],
    [
      "the same nominal generic inside a regular recursive one",
      `type Tagged(U) = nominal U
type Yen   = nominal Int
type Cents = nominal Int
type W(T)  = WLeaf | WNode(Tagged(T), W(T))
fn a(w: W(Yen)) -> W(Cents) = w
fn b(w: W(Int)) -> W(Text) = w`,
      ["E0201 Expected W(Text) but got W(Int)"],
    ],
    [
      "a generic that hands its parameter back, compared with the argument's nominal",
      `type Same(T) = T
type Yen   = nominal Int
type Cents = nominal Int
fn a(s: Same(Yen)) -> Same(Cents) = s
fn b(s: Same(Yen)) -> Same(Yen) = s`,
      ["E0201 Expected Same(Cents) but got Same(Yen)"],
    ],
    [
      "the same generic inside a regular recursive one",
      `type Same(T) = T
type Yen   = nominal Int
type Cents = nominal Int
type W(T)  = WLeaf | WNode(Same(T), W(T))
fn a(w: W(Yen)) -> W(Cents) = w
fn b(w: W(Int)) -> W(Cents) = w`,
      ["E0201 Expected W(Cents) but got W(Yen)"],
    ],
    [
      "that generic under a nominal one, inside a regular recursive one",
      `type Same(T)   = T
type Tagged(U) = nominal U
type Yen   = nominal Int
type Cents = nominal Int
type W(T)  = WLeaf | WNode(Tagged(Same(T)), W(T))
fn a(w: W(Yen)) -> W(Cents) = w
fn b(w: W(Int)) -> W(Text) = w`,
      ["E0201 Expected W(Text) but got W(Int)"],
    ],
    [
      "a parameter under an inline nominal, and under a refinement",
      `type Yen   = nominal Int
type Cents = nominal Int
type V(T)  = VLeaf | VNode(nominal T, V(T))
type P(T)  = PLeaf | PNode(T where positive, P(T))
fn a(v: V(Yen)) -> V(Cents) = v
fn b(v: V(Int)) -> V(Text) = v
fn c(p: P(Yen)) -> P(Cents) = p`,
      ["E0201 Expected V(Text) but got V(Int)", "E0201 Expected P(Cents) but got P(Yen)"],
    ],
    [
      "a nominal generic over a record",
      `type Tag(T) = nominal {v: T}
fn a(t: Tag(Int)) -> Tag(Text) = t
fn b(t: Tag(Int)) -> Tag(Float) = t`,
      ["E0201 Expected Tag(Text) but got Tag(Int)"],
    ],
    [
      "a container generic over nominal arguments",
      `type Box(T) = Empty | Full(T)
type Yen   = nominal Int
type Cents = nominal Int
fn a(b: Box(Yen)) -> Box(Cents) = b
fn b(b: Box(Int)) -> Box(Cents) = b
fn c(b: Box(Yen)) -> Box(Int) = b`,
      ["E0201 Expected Box(Cents) but got Box(Yen)"],
    ],
  ]);
});
