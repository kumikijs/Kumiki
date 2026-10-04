// A generic whose recursive occurrence wraps its own argument —
// `type G(T) = Leaf(T) | Node(G(List(T)))` — reaches a union before it reaches
// itself, so it is a legal recursive type (language.md §1.3.6, inv. 4), and
// comparing two types built from it terminates like any other comparison.
//
// Every check here runs under a deadline. `check` is synchronous, so a test
// timeout cannot stop one that never returns; `vm`'s timeout interrupts the
// script it runs, including the call into `check`, and a comparison that does
// not end fails its own test instead of holding the suite.

import { runInNewContext } from "node:vm";
import { check, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `
tile App = text("x")
app Main caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const G = "type G(T) = Leaf(T) | Node(G(List(T)))";

/** How long one `check` may run before it counts as one that does not end. */
const DEADLINE_MS = 5000;

/** The diagnostics `check` reports for `defs`, as `CODE message`. */
function diags(defs: string): string[] {
  const program = parse(lex(`${defs}\n${TAIL}`));
  let errors: KumikiError[];
  try {
    errors = runInNewContext("run()", { run: () => check(program) }, { timeout: DEADLINE_MS });
  } catch (e) {
    if (e instanceof Error && /timed out/.test(e.message)) {
      throw new Error(`check did not finish within ${DEADLINE_MS} ms`);
    }
    throw e;
  }
  return errors.map((e) => `${e.code} ${e.message}`);
}

/** A program whose one reducer performs `write` on a click. */
const writing = (decls: string, write: string) =>
  `${decls}
reducer w on=ui.click(B) do= ${write}
tile B = button(text="b", onClick=w)`;

type Case = readonly [what: string, defs: string, expected: readonly string[]];

const run = (cases: readonly Case[]) => {
  for (const [what, defs, expected] of cases) {
    it(what, () => {
      expect(diags(defs)).toEqual(expected);
    });
  }
};

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
    // `Int` widens to `Float` at every level of the value, as in `Box(Int)`
    // into `Box(Float)`, and `Float` narrows to `Int` at none of them.
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

// An argument contributes what unfolding the definition would compare of it:
// nothing when the comparison never reaches it, its base when a nominal generic
// wraps it, and the whole type as written once a container holds it.
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
  ]);
});

// Two different generics are not compared argument by argument — their
// parameters need not line up — so the comparison unfolds both. When their
// arguments keep growing it stops after a bounded number of re-entries that
// grew and answers yes, as re-entering a pair already being compared does.
describe("two different generics that both grow", () => {
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
  ]);
});

// A regular generic whose recursion swaps its parameters re-enters a pair of
// definitions with different arguments, but nothing grows: the bound counts
// only re-entries that grew, so however many such comparisons one record holds,
// each still ends at a repeated pair with unfolding's answer — here a mismatch
// that shows one level down, in the last field.
describe("a generic that swaps its parameters spends nothing", () => {
  const record = (name: string, n: number, each: string, last: string) =>
    `type ${name} = {${Array.from({ length: n }, (_, i) => `f${i}: ${each}`).join(", ")}, g: ${last}}`;
  run([
    [
      "one generic, in the last of many fields",
      `type Sw(T, U) = SwLeaf(T) | SwNode(Sw(U, T))
${record("R1", 65, "Sw(Int, Text)", "Sw(Int, Text)")}
${record("R2", 65, "Sw(Int, Text)", "Sw(Int, Int)")}
fn f(r: R1) -> R2 = r`,
      ["E0201 Expected R2 but got R1"],
    ],
    [
      "two generics, in the last of many fields",
      `type SA(T, U) = SLeaf(T) | SNode(SA(U, T))
type SB(T, U) = SLeaf(T) | SNode(SB(U, T))
${record("R1", 65, "SA(Int, Text)", "SA(Int, Text)")}
${record("R2", 65, "SB(Int, Text)", "SB(Int, Int)")}
fn f(r: R1) -> R2 = r`,
      ["E0201 Expected R2 but got R1"],
    ],
  ]);
});

// The regular generics around it, each with the answer unfolding gives — the
// relation compares two applications of one generic argument by argument, and
// that has to agree with unfolding wherever unfolding ends.
describe("regular generics keep their answers", () => {
  run([
    [
      "the recursive types of §1.3.6",
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
