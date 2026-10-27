import { describe, expect, it } from "vitest";
import { runTestsSource } from "../src/smoke.ts";

const run = async (source: string) =>
  (await runTestsSource(source)).map((r) => ({
    name: r.name,
    pass: r.pass,
    cases: r.cases,
    ...(r.pass ? {} : { actual: r.actual }),
  }));

const DECLS = `type Box(T)    = {v: T}
type Seq(T)    = End | More(T, Seq(T))
type Chain     = {v: Int, next: Option(Chain)}
type Rose      = {v: Int, kids: List(Rose)}
type Expr      = Lit(Int) | Neg(Term)
type Term      = {e: Expr, note: Option(Term)}
type Steps     = Result(Int, Steps)
type Pos       = Int where positive
type Annot(T)  = {value: T, comments: List(Comment)}
type Comment   = {text: Text, replies: List(Annot(Comment))}
type Alt(A, B) = Nil | Cons(A, Alt(B, A))
type Ranked(T) = {v: T, kids: List(Ranked(T)), other: List(Rank)}
type Rank      = {k: List(Ranked(Int where positive))}`;

/** A slot of `type`, a reducer that writes it back, and a property that the write commits. */
const roundTrip = (type: string, init: string) => `${DECLS}
slot v : ${type} = ${init}
reducer put on=ui.click(PutBtn) do= v := v
tile PutBtn = button(text="put")
app A caps=[] routes={"/" -> PutBtn, "/404" -> PutBtn} init=[]

test round-trips =
    property-test
        for-all   = {x: ${type}}
        given     = {slots: {v: x}, event: {type: ui.click, target: PutBtn}}
        invariant = run-reducer(put).slots.v == x`;

describe("a generated value is one the slot of its type holds", () => {
  // The write is checked against the slot's type, every refinement inside it included, so a
  // generated value outside the type fails the trial with the rejection.
  it.each([
    ["a tuple with a refined member", "Tuple(Text, Int where negative)", '("a", -1)'],
    ["a generic", "Box(Int)", "{v: 1}"],
    ["a generic that recurses", "Seq(Text)", "End"],
    ["a generic inside itself", "Seq(Seq(Int))", "End"],
    ["Unit", "Unit", "()"],
    ["a record that recurses through an Option", "Chain", "{v: 1, next: None}"],
    ["a record that recurses through a List", "Rose", "{v: 1, kids: []}"],
    ["two types that recurse through each other", "Expr", "Lit(1)"],
    ["a Result that recurses", "Steps", "Ok(1)"],
    ["a Map keyed by a tuple", "Map(Tuple(Int, Int), Text)", "{}"],
    ["stacked refinements", "Pos where between(-5, 5)", "1"],
    ["a least length past the default", "Text where len-gt(60)", `"${"a".repeat(61)}"`],
    ["a shape with a length", "Text where email where len-lt(20)", '"a@b.co"'],
    ["a generic reached again under another argument", "Annot(Int)", "{value: 1, comments: []}"],
    ["a generic that swaps its arguments", "Alt(Int, Text)", "Nil"],
    [
      "two instantiations that read alike but refine apart",
      "Ranked(Int)",
      "{v: 1, kids: [], other: []}",
    ],
  ])("%s: %s", async (_, type, init) => {
    expect(await run(roundTrip(type, init))).toEqual([
      { name: "round-trips", pass: true, cases: 100 },
    ]);
  });
});

describe("a for-all over a recursive type", () => {
  // A `fn` cannot call itself (E0006), so the invariants read two levels down.
  const SOURCE = `type Tree = Leaf | Node(Int, Tree)
fn isTree(t: Tree) -> Bool = match t with
                               | Leaf       -> true
                               | Node(_, _) -> true
slot tree : Tree = Leaf
reducer grow on=ui.click(GrowBtn) do= tree := Node(0, tree)
tile GrowBtn = button(text="grow")
app A caps=[] routes={"/" -> GrowBtn, "/404" -> GrowBtn} init=[]

test grow-wraps-the-tree =
    property-test
        for-all   = {t: Tree}
        given     = {slots: {tree: t}, event: {type: ui.click, target: GrowBtn}}
        invariant = match run-reducer(grow).slots.tree with
                      | Node(_, rest) -> rest == t
                      | Leaf          -> false

test a-node-holds-a-tree =
    property-test
        for-all   = {t: Tree}
        given     = {slots: {}, event: {type: ui.click, target: GrowBtn}}
        invariant = match t with
                      | Leaf          -> true
                      | Node(_, rest) -> isTree(rest)`;

  it("generates trees that end, every level a Tree", async () => {
    expect(await run(SOURCE)).toEqual([
      { name: "grow-wraps-the-tree", pass: true, cases: 100 },
      { name: "a-node-holds-a-tree", pass: true, cases: 100 },
    ]);
  });
});

describe("a trial whose run-reducer batch is rejected", () => {
  // `inc` holds the invariant whenever it runs; at `n = 3` the write is refused.
  const SOURCE = `slot count : Int where between(0, 3) = 0
reducer inc on=ui.click(IncBtn) do= count := count + 1
tile IncBtn = button(text="+1")
app A caps=[] routes={"/" -> IncBtn, "/404" -> IncBtn} init=[]

test inc-stays-in-range =
    property-test
        for-all   = {n: Int where between(0, 3)}
        given     = {slots: {count: n}, event: {type: ui.click, target: IncBtn}}
        invariant = run-reducer(inc).slots.count >= 0`;

  it("fails the property with the counterexample and the rejection", async () => {
    const [result] = await run(SOURCE);
    expect(result).toMatchObject({ name: "inc-stays-in-range", pass: false });
    expect(result?.actual).toMatch(
      /^counterexample \(case \d+\/100\): \{"n":3\} — reducer "inc" was rejected: slot "count" cannot hold 4 \(between\(0, 3\)\)$/,
    );
  });
});

describe("a shrunk counterexample", () => {
  const REFINED = `slot count : Int = 0
reducer go on=ui.click(GoBtn) do= count := count + 1
tile GoBtn = button(text="go")
app A caps=[] routes={"/" -> GoBtn, "/404" -> GoBtn} init=[]

test positive-is-never-negative =
    property-test
        for-all   = {v: Int where positive}
        given     = {slots: {}, event: {type: ui.click, target: GoBtn}}
        invariant = v < 0

test an-address-is-long =
    property-test
        for-all   = {e: Text where email}
        given     = {slots: {}, event: {type: ui.click, target: GoBtn}}
        invariant = e.length > 100`;

  it("stays inside the domain its refinement declares", async () => {
    const [positive, address] = await run(REFINED);
    expect(positive?.actual).toBe('counterexample (case 1/100): {"v":1}');
    expect(address?.actual).toMatch(
      /^counterexample \(case 1\/100\): \{"e":"[a-z]@[a-z]\.example\.com"\}$/,
    );
  });

  // `dec` is refused at n = 0 and commits 0..10 for n in 1..11, so the invariant fails both ways.
  const REFUSED = `slot count : Int where between(0, 100) = 0
reducer dec on=ui.click(DecBtn) do= count := count - 1
tile DecBtn = button(text="-1")
app A caps=[] routes={"/" -> DecBtn, "/404" -> DecBtn} init=[]

test dec-stays-above-ten =
    property-test
        for-all   = {n: Int where between(0, 100)}
        given     = {slots: {count: n}, event: {type: ui.click, target: DecBtn}}
        invariant = run-reducer(dec).slots.count > 10`;

  it("fails the way the generated case did, so is not one whose batch was refused", async () => {
    const [result] = await run(REFUSED);
    expect(result?.actual).toBe('counterexample (case 1/100): {"n":1}');
  });
});

describe("a trial that panics", () => {
  const SOURCE = `slot n : Int = 0
reducer inc on=ui.click(IncBtn) do= n := n + 1
tile IncBtn = button(text="+1")
app A caps=[] routes={"/" -> IncBtn, "/404" -> IncBtn} init=[]

test first-is-large =
    property-test
        for-all   = {xs: List(Int)}
        given     = {slots: {}, event: {type: ui.click, target: IncBtn}}
        invariant = xs[0] >= -1000`;

  it("fails with the panic, told apart from an invariant that is false", async () => {
    const [result] = await run(SOURCE);
    expect(result).toMatchObject({ name: "first-is-large", pass: false });
    expect(result?.actual).toMatch(
      /^counterexample \(case \d+\/100\): \{"xs":\[\]\} — panicked: Index 0 is out of range for a List of length 0$/,
    );
  });
});
