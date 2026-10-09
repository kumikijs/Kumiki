// A property-test holds only on trials that ran (testing.md §8.3.1, §8.3.2): its
// `for-all` values are values of their types, and a `run-reducer` whose batch
// is rejected fails the trial instead of answering the state it started from.
//
// Each program goes through `kumiki test`'s own path — compiled with its tests,
// loaded, run — so the descriptor codegen emits and the generator the runtime
// reads are the ones a user's run meets.

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
  // The issue's program: `put` writes the pair back and counts the write. The
  // pair is refined inside its type, so a trial handed anything but a pair
  // whose second half is negative would have its batch rejected.
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

  it("generates each pair element by element, so the reducer runs on every trial", {
    timeout: 30_000,
  }, async () => {
    expect(await run(SOURCE)).toEqual([
      { name: "pair-never-moves", pass: true, cases: 100 },
      { name: "put-counts-once", pass: true, cases: 100 },
      { name: "second-half-is-negative", pass: true, cases: 100 },
    ]);
  });
});

describe("a for-all over a recursive type", () => {
  // A `fn` cannot call itself (E0006), so the invariants read two levels down
  // rather than walking the whole value; a `Node` whose rest is not a `Tree`
  // fails the match there.
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

  it("generates trees that end, every level a Tree", { timeout: 30_000 }, async () => {
    expect(await run(SOURCE)).toEqual([
      { name: "grow-wraps-the-tree", pass: true, cases: 100 },
      { name: "a-node-holds-a-tree", pass: true, cases: 100 },
    ]);
  });
});

describe("a trial whose run-reducer batch is rejected", () => {
  // `inc` holds the invariant whenever it runs. At `n = 3` the write is
  // refused, so that trial is one where nothing ran.
  const SOURCE = `slot count : Int where between(0, 3) = 0
reducer inc on=ui.click(IncBtn) do= count := count + 1
tile IncBtn = button(text="+1")
app A caps=[] routes={"/" -> IncBtn, "/404" -> IncBtn} init=[]

test inc-stays-in-range =
    property-test
        for-all   = {n: Int where between(0, 3)}
        given     = {slots: {count: n}, event: {type: ui.click, target: IncBtn}}
        invariant = run-reducer(inc).slots.count >= 0`;

  it("fails the property with the counterexample and the rejection", {
    timeout: 30_000,
  }, async () => {
    const [result] = await run(SOURCE);
    expect(result).toMatchObject({ name: "inc-stays-in-range", pass: false });
    expect(result?.actual).toMatch(
      /^counterexample \(case \d+\/100\): \{"n":3\} — reducer "inc" was rejected: slot "count" cannot hold 4 \(between\(0, 3\)\)$/,
    );
  });
});

describe("a shrunk counterexample", () => {
  // The issue's program, and a form beside it: each counterexample is shrunk
  // inside the domain its refinement gives the generator.
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

  it("stays inside the domain its refinement declares", { timeout: 30_000 }, async () => {
    const [positive, address] = await run(REFINED);
    expect(positive?.actual).toBe('counterexample (case 1/100): {"v":1}');
    expect(address?.actual).toMatch(
      /^counterexample \(case 1\/100\): \{"e":"[a-z]@[a-z]\.example\.com"\}$/,
    );
  });

  // `dec` is refused at n = 0 and commits 0..10 for n in 1..11, so the
  // invariant fails both ways. The generated case ran, so the counterexample
  // is the smallest input on which `dec` ran and the invariant failed.
  const REFUSED = `slot count : Int where between(0, 100) = 0
reducer dec on=ui.click(DecBtn) do= count := count - 1
tile DecBtn = button(text="-1")
app A caps=[] routes={"/" -> DecBtn, "/404" -> DecBtn} init=[]

test dec-stays-above-ten =
    property-test
        for-all   = {n: Int where between(0, 100)}
        given     = {slots: {count: n}, event: {type: ui.click, target: DecBtn}}
        invariant = run-reducer(dec).slots.count > 10`;

  it("fails the way the generated case did, so is not one whose batch was refused", {
    timeout: 30_000,
  }, async () => {
    const [result] = await run(REFUSED);
    expect(result?.actual).toBe('counterexample (case 1/100): {"n":1}');
  });
});
