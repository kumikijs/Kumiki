import { describe, expect, it } from "vitest";
import { runTestsSource } from "../src/smoke.ts";

const run = async (source: string) =>
  (await runTestsSource(source)).map((r) => ({
    name: r.name,
    pass: r.pass,
    cases: r.cases,
    ...(r.pass ? {} : { actual: r.actual }),
  }));

describe("a for-all over a Tuple", () => {
  // The pair is refined inside its type, so a trial handed any other pair would have its batch rejected.
  const SOURCE = `slot pair : Tuple(Text, Int where negative) = ("a", -1)
slot hits : Int = 0
reducer put on=ui.click(PutBtn) do= hits := hits + 1
                                    pair := pair
tile PutBtn = button(text="put")
app A caps=[] routes={"/" -> PutBtn, "/404" -> PutBtn} init=[]

test pair-never-moves =
    property-test
        for-all   = {p: Tuple(Text, Int where negative)}
        given     = {slots: {pair: p, hits: 0}, event: {type: ui.click, target: PutBtn}}
        invariant = run-reducer(put).slots.pair == p

test put-counts-once =
    property-test
        for-all   = {p: Tuple(Text, Int where negative)}
        given     = {slots: {pair: p, hits: 0}, event: {type: ui.click, target: PutBtn}}
        invariant = run-reducer(put).slots.hits == 1

test second-half-is-negative =
    property-test
        for-all   = {p: Tuple(Text, Int where negative)}
        given     = {slots: {}, event: {type: ui.click, target: PutBtn}}
        invariant = match p with
                      | (_, n) -> n < 0`;

  it("generates each pair element by element, so the reducer runs on every trial", async () => {
    expect(await run(SOURCE)).toEqual([
      { name: "pair-never-moves", pass: true, cases: 100 },
      { name: "put-counts-once", pass: true, cases: 100 },
      { name: "second-half-is-negative", pass: true, cases: 100 },
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
