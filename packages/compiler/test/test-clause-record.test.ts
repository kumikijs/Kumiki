import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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

describe("a test clause that is not a record stops the build", () => {
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
      "a reducer-test `expect` that is a literal",
      `test t =
    reducer-test inc
        given  = {slots: {count: 0}}
        expect = 41`,
      "`expect` must be a record, `{<section>: …}`",
    ],
    [
      "an episode-test `mocks` that is a literal",
      `test t =
    episode-test
        load   = "nope.jsonl"
        mocks  = 41
        expect = {no-panics: true}`,
      "`mocks` must be a record, `{<effect>: <policy>}`",
    ],
    // One level down: the test seeded no slot and asserted no slot, and passed.
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
    [
      "an episode-test `slots-equal` that is a literal",
      `test t =
    episode-test
        load   = "nope.jsonl"
        mocks  = {}
        expect = {slots-equal: 41}`,
      "`expect.slots-equal` must be a record, `{<slot>: …}`, or `from-log`",
    ],
  ])("refuses %s", (_, test, message) => {
    const r = build(program(test));
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    const messages = typeof message === "string" ? [message] : message;
    expect(r.errors.map((e) => [e.code, e.message])).toEqual(messages.map((m) => ["E0713", m]));
  });

  // `{}` parses as an empty map rather than a record, so it takes a branch of its own in both the checker and the lowering; a regression in either would turn a working test into a failed build.
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
