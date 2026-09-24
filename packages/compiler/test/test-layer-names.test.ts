// A `test` definition's names were resolved by nothing.
//
// `checkTest` walks a `given` for misplaced wildcards, a property-test
// invariant for `run-reducer`'s target, and a reducer-test `expect` for
// `<slots.X>`. None of that reaches `checkExpr`, so every other name in a test
// body — a call, a slot, a tile, an effect — was accepted whatever it said, and
// the failure that followed blamed the program rather than the test:
//
//   given  = {slots: {conut: 3}}          the given is dropped; the test passes
//   given  = {event: {target: Nope}}      a claim about a tile that is not one
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

import { check, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

/** A program whose single `test` definition has the given body. */
function withTest(body: string): string {
  return `type Probe = nominal Text where uuid
slot count : Int = 0
slot label : Text = ""
fn double(x: Int) -> Int = x * 2
effect persist cap=storage.write in=Int out=Result(Unit, Text)
reducer inc on=ui.click(B) do= count := count + 1
reducer save on=ui.click(S) do= emit persist(count)
reducer tick on=timer(1s, name=countdown) do= count := count + 1
reducer failed on=persist.err($e, _) do= label := $e
reducer note on=ui.click(B) do= emit toast({message: "hi", tone: "info"})
tile B = button(text="+", onClick=inc)
tile S = button(text="save", onClick=save)
tile Greeting in=Text = heading("Hi, " + $1)
tile App = column(B, S, text(count.show), text(label))
app A caps=[storage.write, notification.show] routes={"/" -> App, "/404" -> App} init=[]
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

  // `route` is the one slot a program cannot declare — the runtime maintains
  // it — so a test naming it had nothing to name, and the reducer reading it
  // had no writable test (testing.md §8.2.5).
  it("accepts the route slot, which no program can declare", () => {
    expect(codes(reducerTest(`{slots: {count: 0, route: {path: "/x"}}}`, EXPECT))).toEqual([]);
    expect(
      codes(reducerTest(GIVEN, `{slots: {count: 1, route: {path: "/x"}}, effects: []}`)),
    ).toEqual([]);
  });

  it("accepts it in an episode-test's `slots-equal`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {route: {path: "/x"}}, no-panics: true}`);
    expect(codes(src)).toEqual([]);
  });

  it("reports a field the route slot does not have", () => {
    // The harness completes a partial route, so a typo'd field would be
    // dropped in silence and the test would run against the empty route —
    // green, and exercising the branch it meant to avoid.
    expect(codes(reducerTest(`{slots: {route: {pathh: "/x"}}}`, EXPECT))).toEqual(["E0108"]);
  });

  it("reports a route seed that is not a record", () => {
    expect(codes(reducerTest(`{slots: {route: "/x"}}`, EXPECT))).toEqual(["E0201"]);
  });
});

describe("the other namespaces a test body names", () => {
  it("reports a ui event target that names no tile", () => {
    // The lowering never reads `target` — `eventPayloadJs` filters it out and
    // the reducer comes from the test's own target — so this is about what the
    // test says rather than what it does: it claims to click a tile that does
    // not exist, and nothing said so.
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

describe("the target is a tile only when the trigger aims at one", () => {
  // `EventPattern` also has timer, effect-outcome and lifecycle triggers, and a
  // reducer driven by one of those has no tile to name. Resolving `target` as a
  // tile on every test kind rejected programs that compile.
  it("accepts a timer name", () => {
    const src = withTest(`    reducer-test tick
        given  = {slots: {count: 0}, event: {type: timer, target: countdown}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codes(src)).toEqual([]);
  });

  it("accepts an effect-outcome trigger with no target at all", () => {
    const src = withTest(`    reducer-test failed
        given  = {slots: {label: ""}, event: {type: persist.err}}
        expect = {slots: {label: ""}, effects: []}`);
    expect(codes(src)).toEqual([]);
  });

  it("accepts an event that names no type at all", () => {
    // What a lifecycle reducer-test can write: `app.start` does not parse in an
    // expression position — `app` is a keyword — so the event it describes has
    // no `type`, and a rule keyed on one must not fire without it.
    const src = withTest(`    reducer-test inc
        given  = {slots: {count: 0}, event: {}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codes(src)).toEqual([]);
  });

  it("still reports a ui target, which is the one that names a tile", () => {
    expect(
      codes(reducerTest(`{slots: {count: 0}, event: {type: ui.click, target: Nope}}`, EXPECT)),
    ).toEqual(["E0105"]);
  });
});

describe("a standard effect is an effect", () => {
  // `navigate`, `toast`, `log` and the rest are declared by no program, so they
  // are absent from the effect table and present in the capability one.
  it("accepts one in `expect.effects`, in both spellings", () => {
    const src = withTest(`    reducer-test note
        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 0}, effects: [toast]}`);
    expect(codes(src)).toEqual([]);
    expect(codes(src.replace("[toast]", '[toast({message: "hi", tone: "info"})]'))).toEqual([]);
  });

  it("still reports a name that is neither", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: 1}, effects: [tost]}`))).toEqual(["E0104"]);
  });
});

describe("`run-reducer` is a callee only a property-test invariant has", () => {
  // It lowers to a read of `_init` / `_event`, bound only inside a generated
  // trial. Written anywhere else, the module dies with `_init is not defined`
  // before a single test reports — so the whole suite goes, and the name that
  // caused it is never mentioned.
  it("reports it in a `given`", () => {
    const given = `{slots: {count: run-reducer(inc).slots.count}, event: {type: ui.click, target: B}}`;
    expect(codes(reducerTest(given, EXPECT))).toEqual(["E0116"]);
  });

  it("reports it in an `expect`", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: run-reducer(inc).slots.count}}`))).toEqual([
      "E0116",
    ]);
  });

  it("reports the chained spelling too", () => {
    const given = `{slots: {count: run-reducer(inc).run-reducer(inc).slots.count}, event: {type: ui.click, target: B}}`;
    expect(codes(reducerTest(given, EXPECT))).toEqual(["E0116", "E0116"]);
  });

  it("says the position is wrong rather than the name", () => {
    const given = `{slots: {count: run-reducer(inc).slots.count}, event: {type: ui.click, target: B}}`;
    const [err] = check(parse(lex(reducerTest(given, EXPECT))));
    expect(err?.message).toBe('Call to "run-reducer" outside a property-test invariant');
  });

  it("counts its argument, and refuses one that is not a name", () => {
    // `reducerNameArg` reads a bare name and answers `""` for anything else;
    // the runner then throws `reducer "" not found`, which the property runner
    // renders as a counterexample against the code under test.
    const inv = (call: string) => property("{n: Int}", "{slots: {count: n}}", `${call} == n`);
    expect(codes(inv("run-reducer(inc, dec).slots.count"))).toEqual(["E0213"]);
    expect(codes(inv("run-reducer().slots.count"))).toEqual(["E0213"]);
    // The message matters as much as the code here: without the shape check the
    // name reads as `undefined` and the diagnostic points at a reducer nobody
    // wrote, which is a different mistake from the one the author made.
    const [err] = check(parse(lex(inv('run-reducer("inc").slots.count'))));
    expect(err?.code).toBe("E0102");
    expect(err?.message).toBe("run-reducer expects a reducer name");
  });
});

describe("a wildcard is reported wherever it is written", () => {
  // The two dedicated passes walk a `given` and a reducer-test `expect`. An
  // invariant and an `episode-test` expect belong to neither, and a wildcard
  // there lowers to a sentinel — so the property is falsified on every trial
  // and rendered as a counterexample against innocent code.
  it("reports one in a property-test invariant", () => {
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "<slots.count> == n"))).toEqual([
      "E0109",
    ]);
  });

  it("reports one in an episode-test `expect`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {count: <slots.count>}, no-panics: true}`);
    expect(codes(src)).toEqual(["E0109"]);
  });
});

describe("a shape whose fallback is an assertion of its own", () => {
  it("reports `expect.effects` that is not a list", () => {
    // `effectListJs` lowers a non-list to `[]`, which asserts that no effect
    // was emitted — so the forgotten brackets do not weaken the test, they
    // replace it with a different one that passes.
    expect(codes(reducerTest(GIVEN, `{slots: {count: 1}, effects: persist(count)}`))).toEqual([
      "E0713",
    ]);
  });

  it("reports a reducer-test mock that is not an outcome", () => {
    const mock = (v: string) =>
      reducerTest(
        `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: ${v}}}`,
        EXPECT,
      );
    // Anything unrecognised lowered to `{outcome: "ok", value: null}`, so a
    // mock written to drive the failure path drove the success one and the
    // test that asserted the failure passed without ever seeing it.
    expect(codes(mock("fail(1)"))).toEqual(["E0713"]);
    expect(codes(mock("delay(10, boom(1))"))).toEqual(["E0713"]);
    expect(codes(mock("nope"))).toEqual(["E0713"]);
    // `from-log` / `ignore` belong to an episode-test's vocabulary only.
    expect(codes(mock("from-log"))).toEqual(["E0713"]);
  });

  it("keeps the episode-test vocabulary where it is", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: ignore}
        expect = {slots-equal: from-log, no-panics: true}`);
    expect(codes(src)).toEqual([]);
    expect(codes(src.replace("ignore", "fail(1)"))).toEqual(["E0712"]);
  });
});

describe("a clause read as a record of sections is a record", () => {
  // Every reader of a `given` / `expect` / `mocks` asks it for its fields, and
  // a value that is not a record literal has none — so the whole clause was
  // read as empty. A `given` that sets nothing runs the reducer from the
  // declared defaults, an `expect` that asserts nothing passes, and a `mocks`
  // that scripts nothing leaves every effect to the log.
  const at = (src: string): { code: string; text: string }[] => {
    const lines = src.split("\n");
    return check(parse(lex(src))).map((e) => ({
      code: e.code,
      text: (lines[e.pos.line - 1] ?? "").slice(e.pos.col - 1),
    }));
  };

  it("reports a reducer-test `given` that is a name, at the clause, and nothing else", () => {
    // `setup` resolves to nothing, but it is the clause's shape that is wrong:
    // a `given` is never a value to be looked up, so one diagnostic.
    expect(at(reducerTest("setup", EXPECT))).toEqual([{ code: "E0713", text: "setup" }]);
  });

  it("reports a reducer-test `given` that is a literal", () => {
    expect(at(reducerTest("41", EXPECT))).toEqual([{ code: "E0713", text: "41" }]);
  });

  it("reports a reducer-test `expect` that is not a record", () => {
    expect(at(reducerTest(GIVEN, "41"))).toEqual([{ code: "E0713", text: "41" }]);
  });

  it("reports a tile-test `given` that is not a record", () => {
    const src = withTest(`    tile-test Greeting
        given  = 41
        expect = heading("Hi, Ada")`);
    expect(at(src)).toEqual([{ code: "E0713", text: "41" }]);
  });

  it("reports a property-test `given` that is not a record", () => {
    expect(at(property("{n: Int}", "41", "n == n"))).toEqual([{ code: "E0713", text: "41" }]);
  });

  it("reports an episode-test `mocks` that is not a record", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = 41
        expect = {no-panics: true}`);
    expect(at(src)).toEqual([{ code: "E0713", text: "41" }]);
  });

  it("reports an episode-test `expect` that is not a record", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: ignore}
        expect = 41`);
    expect(at(src)).toEqual([{ code: "E0713", text: "41" }]);
  });

  it("reports a reducer-test `given.mocks` that is not a record", () => {
    const src = reducerTest(
      `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: 41}`,
      EXPECT,
    );
    expect(at(src)).toEqual([{ code: "E0713", text: "41}" }]);
  });

  it("reports a `given.event` that is not a record", () => {
    const src = reducerTest(`{slots: {count: 0}, event: 41}`, EXPECT);
    expect(at(src)).toEqual([{ code: "E0713", text: "41}" }]);
  });

  it("accepts `{}`, the empty record as written, which parses as an empty map", () => {
    expect(codes(reducerTest("{}", `{slots: {count: 1}, effects: []}`))).toEqual([]);
  });

  it("leaves a tile-test `expect` and a property-test `invariant` to their own rules", () => {
    const tile = withTest(`    tile-test Greeting
        given  = {slots: {}, in: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(codes(tile)).toEqual([]);
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "n == n"))).toEqual([]);
  });

  describe("a caller that skips `check` gets a throw, not an empty record", () => {
    const lower = (src: string) => () =>
      codegen(parse(lex(src)), { runtimeSpecifier: "@kumikijs/runtime", includeTests: true });

    it("throws on a `given` that is not a record", () => {
      expect(lower(reducerTest("setup", EXPECT))).toThrow(/E0713 .*`given` must be a record/);
    });

    it("throws on an `expect` that is not a record", () => {
      expect(lower(reducerTest(GIVEN, "41"))).toThrow(/E0713 .*`expect` must be a record/);
    });

    it("throws on an episode-test `mocks` that is not a record", () => {
      const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = 41
        expect = {no-panics: true}`);
      expect(lower(src)).toThrow(/E0713 .*`mocks` must be a record/);
    });

    it("throws on an episode-test `expect` that is not a record", () => {
      const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: ignore}
        expect = 41`);
      expect(lower(src)).toThrow(/E0713 .*`expect` must be a record/);
    });

    it("throws on a `given.mocks` that is not a record", () => {
      const src = reducerTest(
        `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: 41}`,
        EXPECT,
      );
      expect(lower(src)).toThrow(/E0713 .*`given.mocks` must be a record/);
    });

    it("throws on a `given.event` that is not a record", () => {
      expect(lower(reducerTest(`{slots: {count: 0}, event: 41}`, EXPECT))).toThrow(
        /E0713 .*`given.event` must be a record/,
      );
    });
  });
});

describe("a qualifier is spelled the way codegen matches one", () => {
  it("leaves a hyphenated name to E0116", () => {
    // Kumiki names may contain a hyphen and a qualifier may not, so
    // `Othe-Id.fresh()` has no lowering under any spelling. Reporting an
    // undefined *type* there sent the repair at a name it could not fix: the
    // suggestion applied, and the same position reported E0116 instead.
    const src = withTest(`    reducer-test inc
        given  = {slots: {label: Othe-Id.fresh()}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codes(src)).toEqual(["E0116"]);
  });

  it("still reports one that is spelled as a qualifier", () => {
    const src = withTest(`    reducer-test inc
        given  = {slots: {label: OtherId.fresh()}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codes(src)).toEqual(["E0117"]);
  });
});

describe("a section name is one the test kind accepts", () => {
  // The sections are read by name — `slots`, `event`, `mocks`, … — and a name
  // outside that set was dropped rather than reported. The dropped section is
  // the test's own setup, so what ran was the defaults:
  //
  //   given  = {slot: {count: 41}, event: {type: ui.click, target: B}}
  //   expect = {slots: {count: 1}, effects: []}
  //
  // passes — `count` starts at its declared 0, `inc` makes it 1, and the 41 the
  // author wrote never happens. The assertion holds against a state nobody chose.
  //
  // `message` asks for the E0714 by code rather than taking the first
  // diagnostic: a dropped section can carry a second one (see the wildcard case
  // below), and a positional read would then assert about whichever came first.
  const message = (src: string): string | undefined =>
    check(parse(lex(src))).find((e) => e.code === "E0714")?.message;
  const sectionError = (src: string) =>
    defined(
      check(parse(lex(src))).find((e) => e.code === "E0714"),
      "an E0714 diagnostic",
    );

  it("reports a `given` section a reducer-test does not have", () => {
    expect(
      codes(reducerTest(`{slot: {count: 41}, event: {type: ui.click, target: B}}`, EXPECT)),
    ).toEqual(["E0714"]);
  });

  it("names the section it would have been, and the set it came from", () => {
    const src = reducerTest(`{slot: {count: 41}, event: {type: ui.click, target: B}}`, EXPECT);
    expect(message(src)).toBe(
      'Unknown section "slot" in a reducer-test `given` — did you mean "slots"? ' +
        "(accepted: slots, event, mocks)",
    );
  });

  it("reports it at the key, not at the record that holds it", () => {
    // The repair is a one-token rewrite, so the position has to be the token.
    const src = reducerTest(`{slot: {count: 41}, event: {type: ui.click, target: B}}`, EXPECT);
    const pos = sectionError(src).pos;
    const line = defined(src.split("\n")[pos.line - 1], `line ${pos.line} of the source`);
    expect(line.slice(pos.col - 1)).toMatch(/^slot:/);
  });

  it("offers no suggestion for a name that is close to none of them", () => {
    const src = reducerTest(`{initial: {count: 41}, event: {type: ui.click, target: B}}`, EXPECT);
    expect(message(src)).toBe(
      'Unknown section "initial" in a reducer-test `given` (accepted: slots, event, mocks)',
    );
  });

  it("does not let the two-letter `in` claim every tile-test key that starts with it", () => {
    // `initial` in a tile-test means `slots`. A prefix rule without a length
    // floor on the candidate answers `in`, which is a repair at the wrong name.
    const src = withTest(`    tile-test Greeting
        given  = {initial: {}, in: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(message(src)).toBe(
      'Unknown section "initial" in a tile-test `given` (accepted: slots, in)',
    );
  });

  it("offers nothing when two accepted names are equally close", () => {
    // `no` is the same distance from `no-panics` as from `no-errors`, and the
    // table's declaration order is not a reason to prefer one.
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {no: true, slots-equal: from-log}`);
    expect(message(src)).toBe(
      'Unknown section "no" in an episode-test `expect` ' +
        "(accepted: slots-equal, no-panics, no-errors)",
    );
  });

  it("says so when the name belongs to the test's other clause", () => {
    // `effects` is spelled right and written in the wrong place, so no distance
    // rule has anything to offer: the clause is the whole of the mistake.
    const given = `{slots: {count: 0}, event: {type: ui.click, target: B}, effects: []}`;
    expect(message(reducerTest(given, EXPECT))).toBe(
      'Unknown section "effects" in a reducer-test `given` — "effects" is an `expect` section ' +
        "(accepted: slots, event, mocks)",
    );
  });

  it("reports an `expect` section a reducer-test does not have", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: 1}, effect: []}`))).toEqual(["E0714"]);
    expect(codes(reducerTest(GIVEN, `{panics: "boom"}`))).toEqual(["E0714"]);
  });

  it("reports one in a tile-test's `given`", () => {
    const src = withTest(`    tile-test Greeting
        given  = {slots: {}, input: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(codes(src)).toEqual(["E0714"]);
  });

  it("reports one in a property-test's `given`", () => {
    expect(codes(property("{n: Int}", "{slot: {count: n}}", "double(n) == n * 2"))).toEqual([
      "E0714",
    ]);
  });

  it("reports one in an episode-test's `expect`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-eq: from-log, no-panics: true}`);
    expect(codes(src)).toEqual(["E0714"]);
    expect(message(src)).toBe(
      'Unknown section "slots-eq" in an episode-test `expect` — did you mean "slots-equal"? ' +
        "(accepted: slots-equal, no-panics, no-errors)",
    );
  });

  it("resolves no name inside the section it dropped", () => {
    // The names under an unknown section belong to a section that does not
    // exist, so reporting them would name a second mistake at a position that
    // stops existing once the first is fixed.
    expect(codes(reducerTest(`{slot: {conut: doubel(1)}}`, EXPECT))).toEqual(["E0714"]);
  });

  it("still reports what is wrong wherever it is written", () => {
    // A wildcard is illegal in a `given` in any section (E0109), and a
    // `<slots.X>` names a slot wherever it appears (E0103). Both survive fixing
    // the section name, so both are reported alongside E0714 rather than held
    // back by it — `checkTest`'s own two walks cover the whole clause.
    expect(codes(reducerTest(`{slot: {count: <any-id>}}`, EXPECT))).toEqual(["E0714", "E0109"]);
    expect(codes(reducerTest(GIVEN, `{slotz: {count: <slots.conut>}, effects: []}`))).toEqual([
      "E0714",
      "E0103",
    ]);
  });

  it("accepts every section each kind does have", () => {
    const mocked = `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: err("x")}}`;
    expect(codes(reducerTest(mocked, EXPECT))).toEqual([]);
    expect(codes(reducerTest(GIVEN, `{panic: "boom"}`))).toEqual([]);
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "double(n) == n * 2"))).toEqual([]);
    const tile = withTest(`    tile-test Greeting
        given  = {slots: {}, in: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(codes(tile)).toEqual([]);
    const episode = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: from-log, no-panics: true, no-errors: true}`);
    expect(codes(episode)).toEqual([]);
  });

  it("reports the camelCase spellings the lowering used to read", () => {
    // `slotsEqual` / `noPanics` / `noErrors` were read by `episodeExpectJs` and
    // documented by nothing — a vocabulary only a code comment knew about. The
    // spec writes the hyphenated names, so those are the language's.
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slotsEqual: from-log, noPanics: true}`);
    expect(codes(src)).toEqual(["E0714", "E0714"]);
  });
});
