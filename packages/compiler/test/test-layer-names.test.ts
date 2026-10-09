import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { EXPECT, GIVEN, property, reducerTest, withTest } from "./helpers/test-layer.ts";

describe("a call in a test body resolves like a call anywhere else", () => {
  it("reports an undefined call in a property-test invariant", () => {
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "doubel(n) == n * 2"))).toEqual([
      "E0116",
    ]);
  });

  it("accepts the declared one", () => {
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "double(n) == n * 2"))).toEqual([]);
  });

  it("reports one in a reducer-test `given`", () => {
    expect(codesOf(reducerTest(`{slots: {count: doubel(1)}}`, EXPECT))).toEqual(["E0116"]);
  });

  it("reports one in a reducer-test `expect`", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: doubel(1)}, effects: []}`))).toEqual([
      "E0116",
    ]);
  });

  it("reports one in an `expect.panic`", () => {
    expect(codesOf(reducerTest(GIVEN, `{panic: doubel(1)}`))).toEqual(["E0116"]);
  });

  it("reports one in a mock's payload", () => {
    const given = `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: err(doubel(1))}}`;
    expect(codesOf(reducerTest(given, EXPECT))).toEqual(["E0116"]);
  });

  it("reports one in a tile-test's `in`", () => {
    const src = withTest(`    tile-test Greeting
        given  = {slots: {}, in: doubel(1)}
        expect = heading("Hi, 2")`);
    expect(codesOf(src)).toEqual(["E0116"]);
  });

  it("reports one in an episode-test `expect`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {count: doubel(1)}, no-panics: true}`);
    expect(codesOf(src)).toEqual(["E0116"]);
  });
});

describe("the schema positions are not expressions, and are not read as any", () => {
  it("accepts the event's type and target", () => {
    expect(codesOf(reducerTest(GIVEN, EXPECT))).toEqual([]);
  });

  it("accepts an effect in `expect.effects`, in both spellings", () => {
    const src = withTest(`    reducer-test save
        given  = {slots: {count: 1}, event: {type: ui.click, target: S}}
        expect = {slots: {count: 1}, effects: [persist(1)]}`);
    expect(codesOf(src)).toEqual([]);
    expect(codesOf(src.replace("persist(1)", "persist"))).toEqual([]);
  });

  it("accepts every mock spelling", () => {
    const mock = (v: string) =>
      reducerTest(
        `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: ${v}}}`,
        EXPECT,
      );
    for (const v of ["ok(())", 'err("x")', "delay(10, ok(()))"]) {
      expect(codesOf(mock(v)), v).toEqual([]);
    }
  });

  it("accepts `from-log` and `ignore` in an episode-test's mocks", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: from-log}
        expect = {slots-equal: from-log, no-panics: true}`);
    expect(codesOf(src)).toEqual([]);
  });

  it("accepts `run-reducer`, which is a callee no other position has", () => {
    const inv = "run-reducer(inc).run-reducer(inc).slots.count == n + 2";
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", inv))).toEqual([]);
  });

  it("still reports a `run-reducer` target that is not a reducer", () => {
    const inv = "run-reducer(nope).slots.count == n";
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", inv))).toEqual(["E0102"]);
  });
});

describe("a slot key names a slot", () => {
  it("reports one that does not, in `given`", () => {
    expect(codesOf(reducerTest(`{slots: {conut: 3}}`, EXPECT))).toEqual(["E0103"]);
  });

  it("reports one that does not, in `expect`", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {conut: 1}, effects: []}`))).toEqual(["E0103"]);
  });

  it("reports one in an episode-test's `slots-equal`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {conut: 1}, no-panics: true}`);
    expect(codesOf(src)).toEqual(["E0103"]);
  });

  it("accepts the slots the program declares", () => {
    expect(codesOf(reducerTest(`{slots: {count: 0, label: "x"}}`, EXPECT))).toEqual([]);
  });

  it("accepts the route slot, which no program can declare", () => {
    expect(codesOf(reducerTest(`{slots: {count: 0, route: {path: "/x"}}}`, EXPECT))).toEqual([]);
    expect(
      codesOf(reducerTest(GIVEN, `{slots: {count: 1, route: {path: "/x"}}, effects: []}`)),
    ).toEqual([]);
  });

  it("accepts it in an episode-test's `slots-equal`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {route: {path: "/x"}}, no-panics: true}`);
    expect(codesOf(src)).toEqual([]);
  });

  it("reports a field the route slot does not have", () => {
    expect(codesOf(reducerTest(`{slots: {route: {pathh: "/x"}}}`, EXPECT))).toEqual(["E0108"]);
  });

  it("reports a route seed that is not a record", () => {
    expect(codesOf(reducerTest(`{slots: {route: "/x"}}`, EXPECT))).toEqual(["E0201"]);
  });
});

describe("the other namespaces a test body names", () => {
  it("reports a ui event target that names no tile", () => {
    expect(
      codesOf(reducerTest(`{slots: {count: 0}, event: {type: ui.click, target: Nope}}`, EXPECT)),
    ).toEqual(["E0105"]);
  });

  it("reports an effect that is not declared, in both spellings", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: 1}, effects: [persistt(1)]}`))).toEqual([
      "E0104",
    ]);
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: 1}, effects: [persistt]}`))).toEqual([
      "E0104",
    ]);
  });

  it("keeps reporting a mock key that is not an effect", () => {
    const given = `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persistt: ok("x")}}`;
    expect(codesOf(reducerTest(given, EXPECT))).toEqual(["E0104"]);
  });
});

describe("what a test body may read", () => {
  it("accepts a slot reference, which lowers to a live read", () => {
    expect(codesOf(reducerTest(`{slots: {label: label}}`, EXPECT))).toEqual([]);
  });

  it("reports a name that is neither a slot nor a bind", () => {
    expect(codesOf(reducerTest(`{slots: {count: nope}}`, EXPECT))).toEqual(["E0103"]);
  });

  it("binds the `for-all` names in both `given` and `invariant`", () => {
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "n == n"))).toEqual([]);
  });

  it("knows what a `for-all` name is, not only that it exists", () => {
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "n.floor == n"))).toEqual([]);
    expect(codesOf(property("{s: Text}", "{slots: {label: s}}", "s.floor == 1"))).toEqual([
      "E0108",
    ]);
  });

  it("has no `$1` to read", () => {
    expect(codesOf(reducerTest(`{slots: {count: $1}}`, EXPECT))).toEqual(["E0103"]);
  });
});

describe("one mistake draws one diagnostic", () => {
  it("reports a wildcard in a `given` once", () => {
    expect(codesOf(reducerTest(`{slots: {count: <any-id>}}`, EXPECT))).toEqual(["E0109"]);
  });

  it("accepts a wildcard in a reducer-test `expect`", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: <any-id>}, effects: []}`))).toEqual([]);
  });

  it("reports a `<slots.X>` naming nothing once", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: <slots.conut>}, effects: []}`))).toEqual([
      "E0103",
    ]);
  });
});

describe("the target is a tile only when the trigger aims at one", () => {
  it("accepts a timer name", () => {
    const src = withTest(`    reducer-test tick
        given  = {slots: {count: 0}, event: {type: timer, target: countdown}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codesOf(src)).toEqual([]);
  });

  it("accepts an effect-outcome trigger with no target at all", () => {
    const src = withTest(`    reducer-test failed
        given  = {slots: {label: ""}, event: {type: persist.err}}
        expect = {slots: {label: ""}, effects: []}`);
    expect(codesOf(src)).toEqual([]);
  });

  it("accepts an event that names no type at all", () => {
    const src = withTest(`    reducer-test inc
        given  = {slots: {count: 0}, event: {}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codesOf(src)).toEqual([]);
  });

  it("still reports a ui target, which is the one that names a tile", () => {
    expect(
      codesOf(reducerTest(`{slots: {count: 0}, event: {type: ui.click, target: Nope}}`, EXPECT)),
    ).toEqual(["E0105"]);
  });
});

describe("a standard effect is an effect", () => {
  it("accepts one in `expect.effects`, in both spellings", () => {
    const src = withTest(`    reducer-test note
        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 0}, effects: [toast]}`);
    expect(codesOf(src)).toEqual([]);
    expect(codesOf(src.replace("[toast]", '[toast({kind: "info", text: "hi"})]'))).toEqual([]);
  });

  it("holds the expected argument to the standard effect's in=", () => {
    const src = withTest(`    reducer-test note
        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 0}, effects: [toast({message: "hi", tone: "info"})]}`);
    expect(codesOf(src).sort()).toEqual(["E0214", "E0214", "E0215", "E0215"]);
    // The fields the reducer may leave out, the expectation may too.
    expect(
      codesOf(src.replace('{message: "hi", tone: "info"}', '{kind: "info", text: "hi"}')),
    ).toEqual([]);
  });

  it("still reports a name that is neither", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: 1}, effects: [tost]}`))).toEqual(["E0104"]);
  });
});

describe("`run-reducer` is a callee only a property-test invariant has", () => {
  it("reports it in a `given`", () => {
    const given = `{slots: {count: run-reducer(inc).slots.count}, event: {type: ui.click, target: B}}`;
    expect(codesOf(reducerTest(given, EXPECT))).toEqual(["E0116"]);
  });

  it("reports it in an `expect`", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: run-reducer(inc).slots.count}}`))).toEqual([
      "E0116",
    ]);
  });

  it("reports the chained spelling too", () => {
    const given = `{slots: {count: run-reducer(inc).run-reducer(inc).slots.count}, event: {type: ui.click, target: B}}`;
    expect(codesOf(reducerTest(given, EXPECT))).toEqual(["E0116", "E0116"]);
  });

  it("says the position is wrong rather than the name", () => {
    const given = `{slots: {count: run-reducer(inc).slots.count}, event: {type: ui.click, target: B}}`;
    const [err] = checkSource(reducerTest(given, EXPECT));
    expect(err?.message).toBe('Call to "run-reducer" outside a property-test invariant');
  });

  it("counts its argument, and refuses one that is not a name", () => {
    const inv = (call: string) => property("{n: Int}", "{slots: {count: n}}", `${call} == n`);
    expect(codesOf(inv("run-reducer(inc, dec).slots.count"))).toEqual(["E0213"]);
    expect(codesOf(inv("run-reducer().slots.count"))).toEqual(["E0213"]);
    const [err] = checkSource(inv('run-reducer("inc").slots.count'));
    expect(err?.code).toBe("E0102");
    expect(err?.message).toBe("run-reducer expects a reducer name");
  });
});

describe("a wildcard is reported wherever it is written", () => {
  it("reports one in a property-test invariant", () => {
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "<slots.count> == n"))).toEqual([
      "E0109",
    ]);
  });

  it("reports one in an episode-test `expect`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {count: <slots.count>}, no-panics: true}`);
    expect(codesOf(src)).toEqual(["E0109"]);
  });
});

describe("a shape whose fallback is an assertion of its own", () => {
  it("reports `expect.effects` that is not a list", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: 1}, effects: persist(count)}`))).toEqual([
      "E0713",
    ]);
  });

  it("reports a reducer-test mock that is not an outcome", () => {
    const mock = (v: string) =>
      reducerTest(
        `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: ${v}}}`,
        EXPECT,
      );
    expect(codesOf(mock("fail(1)"))).toEqual(["E0713"]);
    expect(codesOf(mock("delay(10, boom(1))"))).toEqual(["E0713"]);
    expect(codesOf(mock("nope"))).toEqual(["E0713"]);
    // `from-log` / `ignore` belong to an episode-test's vocabulary only.
    expect(codesOf(mock("from-log"))).toEqual(["E0713"]);
  });

  it("keeps the episode-test vocabulary where it is", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: ignore}
        expect = {slots-equal: from-log, no-panics: true}`);
    expect(codesOf(src)).toEqual([]);
    expect(codesOf(src.replace("ignore", "fail(1)"))).toEqual(["E0712"]);
  });
});

describe("a qualifier is spelled the way codegen matches one", () => {
  it("leaves a hyphenated name to E0116", () => {
    const src = withTest(`    reducer-test inc
        given  = {slots: {label: Othe-Id.fresh()}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codesOf(src)).toEqual(["E0116"]);
  });

  it("still reports one that is spelled as a qualifier", () => {
    const src = withTest(`    reducer-test inc
        given  = {slots: {label: OtherId.fresh()}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}, effects: []}`);
    expect(codesOf(src)).toEqual(["E0117"]);
  });
});

describe("a section name is one the test kind accepts", () => {
  const message = (src: string): string | undefined =>
    checkSource(src).find((e) => e.code === "E0714")?.message;
  const sectionError = (src: string) =>
    defined(
      checkSource(src).find((e) => e.code === "E0714"),
      "an E0714 diagnostic",
    );

  it("reports a `given` section a reducer-test does not have", () => {
    expect(
      codesOf(reducerTest(`{slot: {count: 41}, event: {type: ui.click, target: B}}`, EXPECT)),
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
    const src = withTest(`    tile-test Greeting
        given  = {initial: {}, in: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(message(src)).toBe(
      'Unknown section "initial" in a tile-test `given` (accepted: slots, in)',
    );
  });

  it("offers nothing when two accepted names are equally close", () => {
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
    const given = `{slots: {count: 0}, event: {type: ui.click, target: B}, effects: []}`;
    expect(message(reducerTest(given, EXPECT))).toBe(
      'Unknown section "effects" in a reducer-test `given` — "effects" is an `expect` section ' +
        "(accepted: slots, event, mocks)",
    );
  });

  it("reports an `expect` section a reducer-test does not have", () => {
    expect(codesOf(reducerTest(GIVEN, `{slots: {count: 1}, effect: []}`))).toEqual(["E0714"]);
    expect(codesOf(reducerTest(GIVEN, `{panics: "boom"}`))).toEqual(["E0714"]);
  });

  it("reports one in a tile-test's `given`", () => {
    const src = withTest(`    tile-test Greeting
        given  = {slots: {}, input: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(codesOf(src)).toEqual(["E0714"]);
  });

  it("reports one in a property-test's `given`", () => {
    expect(codesOf(property("{n: Int}", "{slot: {count: n}}", "double(n) == n * 2"))).toEqual([
      "E0714",
    ]);
  });

  it("reports one in an episode-test's `expect`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-eq: from-log, no-panics: true}`);
    expect(codesOf(src)).toEqual(["E0714"]);
    expect(message(src)).toBe(
      'Unknown section "slots-eq" in an episode-test `expect` — did you mean "slots-equal"? ' +
        "(accepted: slots-equal, no-panics, no-errors)",
    );
  });

  it("resolves no name inside the section it dropped", () => {
    expect(codesOf(reducerTest(`{slot: {conut: doubel(1)}}`, EXPECT))).toEqual(["E0714"]);
  });

  it("still reports what is wrong wherever it is written", () => {
    expect(codesOf(reducerTest(`{slot: {count: <any-id>}}`, EXPECT))).toEqual(["E0714", "E0109"]);
    expect(codesOf(reducerTest(GIVEN, `{slotz: {count: <slots.conut>}, effects: []}`))).toEqual([
      "E0714",
      "E0103",
    ]);
  });

  it("accepts every section each kind does have", () => {
    const mocked = `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: {persist: err("x")}}`;
    expect(codesOf(reducerTest(mocked, EXPECT))).toEqual([]);
    expect(codesOf(reducerTest(GIVEN, `{panic: "boom"}`))).toEqual([]);
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "double(n) == n * 2"))).toEqual([]);
    const tile = withTest(`    tile-test Greeting
        given  = {slots: {}, in: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(codesOf(tile)).toEqual([]);
    const episode = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: from-log, no-panics: true, no-errors: true}`);
    expect(codesOf(episode)).toEqual([]);
  });

  it("reports the camelCase spellings the lowering used to read", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slotsEqual: from-log, noPanics: true}`);
    expect(codesOf(src)).toEqual(["E0714", "E0714"]);
  });
});
