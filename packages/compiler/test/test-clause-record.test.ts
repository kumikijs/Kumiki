import { codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { EXPECT, GIVEN, property, reducerTest, withTest } from "./helpers/test-layer.ts";

const program = (test: string): string => `slot count : Int = 0
effect persist cap=storage.write in=Int out=Result(Unit, Text)
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+", onClick=inc)
tile App = column(B, text(count.show))
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
${test}
`;

const build = (src: string) =>
  compile(src, { runtimeSpecifier: "./runtime.js", includeTests: true });

describe("the build agrees with check about a test clause that is not a record", () => {
  it.each([
    [
      "a reducer-test `given` that is a name",
      `test t =
    reducer-test inc
        given  = setup
        expect = {slots: {count: 1}}`,
      "`given` must be a record, `{<section>: …}`",
    ],
    [
      "a reducer-test whose `slots` sections are literals",
      `test t =
    reducer-test inc
        given  = {slots: 41, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}}
test u =
    reducer-test inc
        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}
        expect = {slots: 41}`,
      [
        "`given.slots` must be a record, `{<slot>: …}`",
        "`expect.slots` must be a record, `{<slot>: …}`",
      ],
    ],
  ])("refuses %s", (_, test, message) => {
    const r = build(program(test));
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    const messages = typeof message === "string" ? [message] : message;
    expect(r.errors.map((e) => [e.code, e.message])).toEqual(messages.map((m) => ["E0713", m]));
  });

  // `{}` parses as an empty map, not a record, so the checker and the lowering each special-case it.
  it("still builds `{}` as the empty record", () => {
    const r = build(
      program(`test t =
    reducer-test inc
        given  = {}
        expect = {slots: {count: 1}}
test u =
    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {}
test v =
    reducer-test inc
        given  = {slots: {}}
        expect = {slots: {}}
test w =
    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: from-log}`),
    );
    expect(r.kind).toBe("ok");
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
    return checkSource(src).map((e) => ({
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
    expect(codesOf(episode("from-log"))).toEqual([]);
    expect(codesOf(episode("{count: 1}"))).toEqual([]);
    expect(codesOf(episode("{}"))).toEqual([]);
    expect(codesOf(reducerTest(`{slots: {}}`, `{slots: {}}`))).toEqual([]);
  });

  it("still reports a wildcard in a non-record `given` as E0109, beside E0713", () => {
    expect(at(reducerTest("<any-id>", EXPECT)).map((e) => e.code)).toEqual(["E0713", "E0109"]);
  });

  it("still reports an undefined `<slots.X>` in a non-record reducer-test `expect`", () => {
    // The same holds for E0103: `<slots.nope>` names no slot in any position.
    expect(at(reducerTest(GIVEN, "<slots.nope>")).map((e) => e.code)).toEqual(["E0713", "E0103"]);
  });

  it("accepts `{}`, the empty record as written, which parses as an empty map", () => {
    expect(codesOf(reducerTest("{}", `{slots: {count: 1}, effects: []}`))).toEqual([]);
  });

  it("leaves a tile-test `expect` and a property-test `invariant` to their own rules", () => {
    const tile = withTest(`    tile-test Greeting
        given  = {slots: {}, in: "Ada"}
        expect = heading("Hi, Ada")`);
    expect(codesOf(tile)).toEqual([]);
    expect(codesOf(property("{n: Int}", "{slots: {count: n}}", "n == n"))).toEqual([]);
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
      expect(codesOf(src)).toEqual([]);
      expect(lower(src)).not.toThrow();
    });
  });
});
