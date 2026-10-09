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
reducer note on=ui.click(B) do= emit toast({kind: "info", text: "hi"})
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
    for (const v of ["ok(())", 'err("x")', "delay(10, ok(()))"]) {
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
    expect(codes(reducerTest(`{slots: {route: {pathh: "/x"}}}`, EXPECT))).toEqual(["E0108"]);
  });

  it("reports a route seed that is not a record", () => {
    expect(codes(reducerTest(`{slots: {route: "/x"}}`, EXPECT))).toEqual(["E0201"]);
  });
});

describe("the other namespaces a test body names", () => {
  it("reports a ui event target that names no tile", () => {
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
    expect(codes(reducerTest(`{slots: {label: label}}`, EXPECT))).toEqual([]);
  });

  it("reports a name that is neither a slot nor a bind", () => {
    expect(codes(reducerTest(`{slots: {count: nope}}`, EXPECT))).toEqual(["E0103"]);
  });

  it("binds the `for-all` names in both `given` and `invariant`", () => {
    expect(codes(property("{n: Int}", "{slots: {count: n}}", "n == n"))).toEqual([]);
  });

  it("knows what a `for-all` name is, not only that it exists", () => {
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
  it("accepts one in `expect.effects`, in both spellings", () => {
    const src = withTest(`    reducer-test note
        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 0}, effects: [toast]}`);
    expect(codes(src)).toEqual([]);
    expect(codes(src.replace("[toast]", '[toast({kind: "info", text: "hi"})]'))).toEqual([]);
  });

  it("holds the expected argument to the standard effect's in=", () => {
    const src = withTest(`    reducer-test note
        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 0}, effects: [toast({message: "hi", tone: "info"})]}`);
    expect(codes(src).sort()).toEqual(["E0214", "E0214", "E0215", "E0215"]);
    // The fields the reducer may leave out, the expectation may too.
    expect(
      codes(src.replace('{message: "hi", tone: "info"}', '{kind: "info", text: "hi"}')),
    ).toEqual([]);
  });

  it("still reports a name that is neither", () => {
    expect(codes(reducerTest(GIVEN, `{slots: {count: 1}, effects: [tost]}`))).toEqual(["E0104"]);
  });
});

describe("`run-reducer` is a callee only a property-test invariant has", () => {
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
    const inv = (call: string) => property("{n: Int}", "{slots: {count: n}}", `${call} == n`);
    expect(codes(inv("run-reducer(inc, dec).slots.count"))).toEqual(["E0213"]);
    expect(codes(inv("run-reducer().slots.count"))).toEqual(["E0213"]);
    const [err] = check(parse(lex(inv('run-reducer("inc").slots.count'))));
    expect(err?.code).toBe("E0102");
    expect(err?.message).toBe("run-reducer expects a reducer name");
  });
});

describe("a wildcard is reported wherever it is written", () => {
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
  const SAYS = {
    given: "`given` must be a record, `{<section>: …}`",
    expect: "`expect` must be a record, `{<section>: …}`",
    mocks: "`mocks` must be a record, `{<effect>: <policy>}`",
    "given.mocks": "`given.mocks` must be a record, `{<effect>: <outcome>}`",
    "given.event": "`given.event` must be a record, `{type: …, target: …}`",
    "given.slots": "`given.slots` must be a record, `{<slot>: …}`",
    "expect.slots": "`expect.slots` must be a record, `{<slot>: …}`",
    "expect.slots-equal": "`expect.slots-equal` must be a record, `{<slot>: …}`, or `from-log`",
  } as const;

  const at = (src: string): { code: string; message: string; text: string }[] => {
    const lines = src.split("\n");
    return check(parse(lex(src))).map((e) => ({
      code: e.code,
      message: e.message,
      text: (lines[e.pos.line - 1] ?? "").slice(e.pos.col - 1),
    }));
  };
  const e0713 = (position: keyof typeof SAYS, text: string) => ({
    code: "E0713",
    message: SAYS[position],
    text,
  });

  it("reports a reducer-test `given` that is a name, at the clause, and nothing else", () => {
    expect(at(reducerTest("setup", EXPECT))).toEqual([e0713("given", "setup")]);
  });

  it("reports a reducer-test `given` that is a literal", () => {
    expect(at(reducerTest("41", EXPECT))).toEqual([e0713("given", "41")]);
  });

  it("reports a `given` written as a map, whose string keys name no section", () => {
    expect(at(reducerTest(`{"slots": {count: 5}}`, EXPECT))).toEqual([
      e0713("given", `{"slots": {count: 5}}`),
    ]);
  });

  it("reports a reducer-test `expect` that is not a record", () => {
    expect(at(reducerTest(GIVEN, "41"))).toEqual([e0713("expect", "41")]);
  });

  it("reports a tile-test `given` that is not a record", () => {
    const src = withTest(`    tile-test Greeting
        given  = 41
        expect = heading("Hi, Ada")`);
    expect(at(src)).toEqual([e0713("given", "41")]);
  });

  it("reports a property-test `given` that is not a record", () => {
    expect(at(property("{n: Int}", "41", "n == n"))).toEqual([e0713("given", "41")]);
  });

  it("reports an episode-test `mocks` that is not a record", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = 41
        expect = {no-panics: true}`);
    expect(at(src)).toEqual([e0713("mocks", "41")]);
  });

  it("reports an episode-test `expect` that is not a record", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: ignore}
        expect = 41`);
    expect(at(src)).toEqual([e0713("expect", "41")]);
  });

  it("reports a reducer-test `given.mocks` that is not a record", () => {
    const src = reducerTest(
      `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: 41}`,
      EXPECT,
    );
    expect(at(src)).toEqual([e0713("given.mocks", "41}")]);
  });

  it("reports a `given.event` that is not a record", () => {
    const src = reducerTest(`{slots: {count: 0}, event: 41}`, EXPECT);
    expect(at(src)).toEqual([e0713("given.event", "41}")]);
  });

  it("reports a reducer-test `given.slots` that is not a record", () => {
    expect(at(reducerTest(`{slots: 41, event: {type: ui.click, target: B}}`, EXPECT))).toEqual([
      e0713("given.slots", "41, event: {type: ui.click, target: B}}"),
    ]);
  });

  it("reports a reducer-test `expect.slots` that is not a record", () => {
    expect(at(reducerTest(GIVEN, `{slots: 41}`))).toEqual([e0713("expect.slots", "41}")]);
  });

  it("reports a `given.slots` that is a slot's name, without resolving it", () => {
    expect(at(reducerTest(`{slots: count}`, EXPECT))).toEqual([e0713("given.slots", "count}")]);
  });

  it("reports a tile-test and a property-test `given.slots` that is not a record", () => {
    const tile = withTest(`    tile-test B
        given  = {slots: 41}
        expect = button(text="+", onClick=inc)`);
    expect(at(tile)).toEqual([e0713("given.slots", "41}")]);
    expect(at(property("{n: Int}", "{slots: n}", "n == n"))).toEqual([e0713("given.slots", "n}")]);
  });

  it("reports an episode-test `slots-equal` that is neither a record nor `from-log`", () => {
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: 41}`);
    expect(at(src)).toEqual([e0713("expect.slots-equal", "41}")]);
    expect(at(src.replace("41", "count"))).toEqual([e0713("expect.slots-equal", "count}")]);
  });

  it("accepts `from-log` in place of a record at `slots-equal` only", () => {
    expect(at(reducerTest(`{slots: from-log}`, EXPECT))).toEqual([
      e0713("given.slots", "from-log}"),
    ]);
    expect(at(reducerTest(GIVEN, `{slots: from-log}`))).toEqual([
      e0713("expect.slots", "from-log}"),
    ]);
    expect(SAYS["given.slots"]).not.toContain("from-log");
    expect(SAYS["expect.slots"]).not.toContain("from-log");
  });

  it("reports an `expect.slots` that is not a record beside a `panic`", () => {
    expect(at(reducerTest(GIVEN, `{panic: "boom", slots: 41}`))).toEqual([
      e0713("expect.slots", "41}"),
    ]);
  });

  it("accepts `from-log`, a record and `{}` as `slots-equal`, and `{}` as `slots`", () => {
    const episode = (v: string) =>
      withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: ${v}}`);
    expect(codes(episode("from-log"))).toEqual([]);
    expect(codes(episode("{count: 1}"))).toEqual([]);
    expect(codes(episode("{}"))).toEqual([]);
    expect(codes(reducerTest(`{slots: {}}`, `{slots: {}}`))).toEqual([]);
  });

  it("still reports a wildcard in a non-record `given` as E0109, beside E0713", () => {
    expect(at(reducerTest("<any-id>", EXPECT)).map((e) => e.code)).toEqual(["E0713", "E0109"]);
  });

  it("still reports an undefined `<slots.X>` in a non-record reducer-test `expect`", () => {
    // The same holds for E0103: `<slots.nope>` names no slot in any position.
    expect(at(reducerTest(GIVEN, "<slots.nope>")).map((e) => e.code)).toEqual(["E0713", "E0103"]);
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
    const throws = (position: keyof typeof SAYS) => `E0713 ${SAYS[position]}`;

    it("throws on a `given` that is not a record", () => {
      expect(lower(reducerTest("setup", EXPECT))).toThrow(throws("given"));
    });

    it("throws on a `given` written as a map", () => {
      expect(lower(reducerTest(`{"slots": {count: 5}}`, EXPECT))).toThrow(throws("given"));
    });

    it("throws on an `expect` that is not a record", () => {
      expect(lower(reducerTest(GIVEN, "41"))).toThrow(throws("expect"));
    });

    it("throws on a tile-test `given` that is not a record", () => {
      const src = withTest(`    tile-test Greeting
        given  = 41
        expect = heading("Hi, Ada")`);
      expect(lower(src)).toThrow(throws("given"));
    });

    it("throws on a property-test `given` that is not a record", () => {
      expect(lower(property("{n: Int}", "41", "n == n"))).toThrow(throws("given"));
    });

    it("throws on a property-test `given.event` that is not a record", () => {
      const src = property("{n: Int}", "{slots: {count: n}, event: 41}", "n == n");
      expect(lower(src)).toThrow(throws("given.event"));
    });

    it("throws on an episode-test `mocks` that is not a record", () => {
      const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = 41
        expect = {no-panics: true}`);
      expect(lower(src)).toThrow(throws("mocks"));
    });

    it("throws on an episode-test `expect` that is not a record", () => {
      const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {persist: ignore}
        expect = 41`);
      expect(lower(src)).toThrow(throws("expect"));
    });

    it("throws on a `given.mocks` that is not a record", () => {
      const src = reducerTest(
        `{slots: {count: 0}, event: {type: ui.click, target: B}, mocks: 41}`,
        EXPECT,
      );
      expect(lower(src)).toThrow(throws("given.mocks"));
    });

    it("throws on a `given.event` that is not a record", () => {
      expect(lower(reducerTest(`{slots: {count: 0}, event: 41}`, EXPECT))).toThrow(
        throws("given.event"),
      );
    });

    it("throws on a `given.slots` or `expect.slots` that is not a record", () => {
      expect(lower(reducerTest(`{slots: 41}`, EXPECT))).toThrow(throws("given.slots"));
      expect(lower(reducerTest(GIVEN, `{slots: 41}`))).toThrow(throws("expect.slots"));
      const tile = withTest(`    tile-test B
        given  = {slots: 41}
        expect = button(text="+", onClick=inc)`);
      expect(lower(tile)).toThrow(throws("given.slots"));
      expect(lower(property("{n: Int}", "{slots: n}", "n == n"))).toThrow(throws("given.slots"));
    });

    it("throws on a `slots-equal` that is neither a record nor `from-log`", () => {
      const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: 41}`);
      expect(lower(src)).toThrow(throws("expect.slots-equal"));
      expect(lower(src.replace("41", "count"))).toThrow(throws("expect.slots-equal"));
    });

    it("lowers `{}` as the empty record in every position that takes one", () => {
      const src = withTest(`    reducer-test inc
        given  = {slots: {count: 0}, event: {}, mocks: {}}
        expect = {}
test t2 =
    reducer-test inc
        given  = {}
        expect = {slots: {count: 1}}
test t3 =
    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {}
test t4 =
    tile-test B
        given  = {}
        expect = button(text="+", onClick=inc)
test t5 =
    property-test
        for-all   = {n: Int}
        given     = {}
        invariant = n == n
test t6 =
    property-test
        for-all   = {n: Int}
        given     = {slots: {count: n}, event: {}}
        invariant = n == n
test t7 =
    reducer-test inc
        given  = {slots: {}}
        expect = {slots: {}}
test t8 =
    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: {}}
test t9 =
    tile-test B
        given  = {slots: {}}
        expect = button(text="+", onClick=inc)
test t10 =
    property-test
        for-all   = {n: Int}
        given     = {slots: {}}
        invariant = n == n`);
      expect(codes(src)).toEqual([]);
      expect(lower(src)).not.toThrow();
    });
  });
});

describe("a qualifier is spelled the way codegen matches one", () => {
  it("leaves a hyphenated name to E0116", () => {
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
    expect(codes(reducerTest(`{slot: {conut: doubel(1)}}`, EXPECT))).toEqual(["E0714"]);
  });

  it("still reports what is wrong wherever it is written", () => {
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
    const src = withTest(`    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slotsEqual: from-log, noPanics: true}`);
    expect(codes(src)).toEqual(["E0714", "E0714"]);
  });
});
