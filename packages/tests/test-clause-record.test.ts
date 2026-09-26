// A test's `given`, a reducer-test's or episode-test's `expect`, and an
// episode-test's `mocks` are read as records of named parts (`docs/spec/errors.md`
// E0713). A value that is not a record literal has no parts, so every reader
// used to answer "none": `given = setup` set nothing and the reducer ran from
// the declared defaults, `expect = 41` asserted nothing, and `mocks = 41`
// scripted nothing. `check` said `ok`, `build --tests` emitted it, and the test
// passed against a state or an outcome nobody chose.
//
// The checker's cases, one per position, are in
// `packages/compiler/test/test-layer-names.test.ts`. What this file pins is
// that the two verbs agree: a program `check` rejects for this is a program
// `compile()` refuses to emit, tests included. It also holds the boundary from
// the other side: `{}`, the empty record as written, still builds.

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
  ])("refuses %s", (_, test, message) => {
    const r = build(program(test));
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => [e.code, e.message])).toEqual([["E0713", message]]);
  });

  // `{}` parses as an empty map rather than a record, so it takes a branch of
  // its own in both the checker and the lowering; a regression in either would
  // turn a working test into a failed build.
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
        expect = {}`),
    );
    expect(r.kind).toBe("ok");
  });
});
