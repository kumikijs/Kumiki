// A `test` definition's names were resolved by nothing.
//
// `checkTest` walks a `given` for misplaced wildcards, a property-test
// invariant for `run-reducer`'s target, and a reducer-test `expect` for
// `<slots.X>`. None of that reaches `checkExpr`, so every other name in a test
// body — a call, a slot, a tile, an effect — was accepted whatever it said, and
// the failure that followed blamed the program rather than the test:
//
//   given  = {slots: {conut: 3}}          the given is dropped; the test passes
//   given  = {event: {target: Nope}}      the target is dropped; the test passes
//   invariant = doubel(n) == n * 2        reported as a counterexample at n = 0
//
// The last one is the sharpest: the trial's `doubel is not defined` is caught
// by the property runner and rendered as a falsified invariant, so the output
// accuses the code under test of a bug it does not have.
//
// A test body cannot simply be handed to `checkExpr`, because it is a schema
// rather than an expression: `event: {type: ui.click, target: B}` is not a
// record of values, `effects: [persist(x)]` is not a function call, and
// `mocks: {persist: err("x")}` is not one either. Each position is checked as
// what codegen lowers it as, and this file is the record of which is which.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** A program whose single `test` definition has the given body. */
function withTest(body: string): string {
  return `type Probe = nominal Text where uuid
slot count : Int = 0
slot label : Text = ""
fn double(x: Int) -> Int = x * 2
effect persist cap=storage.write in=Int out=Result(Unit, Text)
reducer inc on=ui.click(B) do= count := count + 1
reducer save on=ui.click(S) do= emit persist(count)
tile B = button(text="+", onClick=inc)
tile S = button(text="save", onClick=save)
tile Greeting in=Text = heading("Hi, " + $1)
tile App = column(B, S, text(count.show), text(label))
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
test t =
${body}
`;
}

const codes = (src: string) => check(parse(lex(src))).map((e) => e.code);

/** A reducer-test with the two halves spelled out. */
const reducerTest = (given: string, expectPart: string) =>
  withTest(`    reducer-test inc
        given  = ${given}
        expect = ${expectPart}`);

const GIVEN = `{slots: {count: 0}, event: {type: ui.click, target: B}}`;
const EXPECT = `{slots: {count: 1}, effects: []}`;

const property = (forAll: string, given: string, invariant: string) =>
  withTest(`    property-test
        for-all   = ${forAll}
        given     = ${given}
        invariant = ${invariant}`);

describe("a call in a test body resolves like a call anywhere else", () => {
  it("reports an undefined call in a property-test invariant", () => {
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "doubel(n) == n * 2"))).toEqual([
      "E0116",
    ]);
  });

  it("accepts the declared one", () => {
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "double(n) == n * 2"))).toEqual([]);
  });

  it("reports one in a reducer-test `given`", () => {
    expect(codes(reducerTest(`{slots: {count: doubel(1)}}`, EXPECT))).toEqual(["E0116"]);
  });

  it("reports one in a reducer-test `expect`", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: doubel(1)}, effects: []}`))).toEqual([
      "E0116",
    ]);
  });

  it("reports one in an `expect.panic`", () => {
    expect(codes(reducerTest(GIVEN, `{panic: doubel(1)}`))).toEqual(["E0116"]);
  });

  it("reports one in a mock's payload", () => {
    const given = `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: err(doubel(1))}}`;
    expect(codes(reducerTest(given, EXPECT))).toEqual(["E0116"]);
  });

  it("reports one in a tile-test's `in`", () => {
    const src = withTest(`    tile-test Greeting
        given  = {slots: {}, in: doubel(1)}
        expect = heading("Hi, 2")`);
    expect(codes(src)).toEqual(["E0116"]);
  });

  it("reports one in an episode-test `expect`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {count: doubel(1)}, no-panics: true}`);
    expect(codes(src)).toEqual(["E0116"]);
  });
});

describe("the schema positions are not expressions, and are not read as any", () => {
  it("accepts the event's type and target", () => {
    // `ui.click` is an event kind and `B` is a tile; neither is a value, and a
    // walk that treated them as one would report a slot named `ui`.
    expect(codes(reducerTest(GIVEN, EXPECT))).toEqual([]);
  });

  it("accepts an effect in `expect.effects`, in both spellings", () => {
    const src = withTest(`    reducer-test save
        given  = {slots: {count: 1}, event: {type: ui.click, target: S}}
        expect = {slots: {count: 1}, effects: [persist(1)]}`);
    expect(codes(src)).toEqual([]);
    expect(codes(src.replace("persist(1)", "persist"))).toEqual([]);
  });

  it("accepts every mock spelling", () => {
    const mock = (v: string) =>
      reducerTest(
        `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: ${v}}}`,
        EXPECT,
      );
    for (const v of ['ok("x")', 'err("x")', 'delay(10, ok("x"))']) {
      expect(codes(mock(v)), v).toEqual([]);
    }
  });

  it("accepts `from-log` and `ignore` in an episode-test's mocks", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: from-log}
        expect = {slots-equal: from-log, no-panics: true}`);
    expect(codes(src)).toEqual([]);
  });

  it("accepts `run-reducer`, which is a callee no other position has", () => {
    const inv = "run-reducer(inc).run-reducer(inc).slots.count == n + 2";
    expect(codes(property("{n: Int}", "{slots: {count: n}}", inv))).toEqual([]);
  });

  it("still reports a `run-reducer` target that is not a reducer", () => {
    const inv = "run-reducer(nope).slots.count == n";
    expect(codes(property("{n: Int}", "{slots: {count: n}}", inv))).toEqual(["E0102"]);
  });
});

describe("a slot key names a slot", () => {
  it("reports one that does not, in `given`", () => {
    // The typo is dropped by `resetLive`, so the test ran against the slot's
    // default and passed — a green test asserting nothing it claimed to.
    expect(codes(reducerTest(`{slots: {conut: 3}}`, EXPECT))).toEqual(["E0103"]);
  });

  it("reports one that does not, in `expect`", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {conut: 1}, effects: []}`))).toEqual(["E0103"]);
  });

  it("reports one in an episode-test's `slots-equal`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {conut: 1}, no-panics: true}`);
    expect(codes(src)).toEqual(["E0103"]);
  });

  it("accepts the slots the program declares", () => {
    expect(codes(reducerTest(`{slots: {count: 0, label: "x"}}`, EXPECT))).toEqual([]);
  });
});

describe("the other namespaces a test body names", () => {
  it("reports an event target that names no tile", () => {
    // Dropped by the lowering, so the test passed while claiming to click a
    // tile that does not exist.
    expect(
      codes(reducerTest(`{slots: {count: 0}, event: {type: ui.click, target: Nope}}`, EXPECT)),
    ).toEqual(["E0105"]);
  });

  it("reports an effect that is not declared, in both spellings", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: 1}, effects: [persistt(1)]}`))).toEqual([
      "E0104",
    ]);
    expect(codes(reducerTest(GIVEN, `{slots: {count: 1}, effects: [persistt]}`))).toEqual([
      "E0104",
    ]);
  });

  it("keeps reporting a mock key that is not an effect", () => {
    const given = `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persistt: ok("x")}}`;
    expect(codes(reducerTest(given, EXPECT))).toEqual(["E0104"]);
  });
});

describe("what a test body may read", () => {
  it("accepts a slot reference, which lowers to a live read", () => {
    // Measured before the check existed: `given = {slots: {count: label}}`
    // reads the slot's value, so rejecting a reference here would reject a
    // working test.
    expect(codes(reducerTest(`{slots: {label: label}}`, EXPECT))).toEqual([]);
  });

  it("reports a name that is neither a slot nor a bind", () => {
    expect(codes(reducerTest(`{slots: {count: nope}}`, EXPECT))).toEqual(["E0103"]);
  });

  it("binds the `for-all` names in both `given` and `invariant`", () => {
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "n == n"))).toEqual([]);
  });

  it("knows what a `for-all` name is, not only that it exists", () => {
    // The generator declares the type, so a member that only a number has is
    // decidable here — the bind carries its type, not just its name.
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "n.floor == n"))).toEqual([]);
    expect(codes(property("{s: Text}", "{slots: {label: s}}", "s.floor == 1"))).toEqual(["E0108"]);
  });

  it("has no `$1` to read", () => {
    expect(codes(reducerTest(`{slots: {count: $1}}`, EXPECT))).toEqual(["E0103"]);
  });
});

describe("one mistake draws one diagnostic", () => {
  it("reports a wildcard in a `given` once", () => {
    expect(codes(reducerTest(`{slots: {count: <any-id>}}`, EXPECT))).toEqual(["E0109"]);
  });

  it("accepts a wildcard in a reducer-test `expect`", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: <any-id>}, effects: []}`))).toEqual([]);
  });

  it("reports a `<slots.X>` naming nothing once", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: <slots.conut>}, effects: []}`))).toEqual([
      "E0103",
    ]);
  });
});
