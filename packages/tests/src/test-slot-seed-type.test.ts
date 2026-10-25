import { readFileSync } from "node:fs";
import { testFile } from "@kumikijs/cli";
import { compile } from "@kumikijs/compiler";
import { resolveCapabilities } from "@kumikijs/compiler/node";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { editedIn } from "./helpers/source.ts";

const EXAMPLE = feature("211-test-slot-seed-type");
const SOURCE = readFileSync(EXAMPLE, "utf8");

/**
 * The example with the first `before + value` in test `test` rewritten as
 * `before + wrong`, and the 1-based line and column `wrong` starts at.
 */
function rewritten(test: string, before: string, value: string, wrong: string) {
  const edit = editedIn(SOURCE, [`test ${test} =`], before + value, before + wrong);
  return { ...edit, col: edit.col + before.length };
}

const build = (source: string) =>
  compile(source, {
    runtimeSpecifier: "./runtime.js",
    includeTests: true,
    capabilities: resolveCapabilities(EXAMPLE),
  });

describe("a slot value in a test is a value of the slot's type", () => {
  it("runs the example's tests as written, wildcards included", async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => [r.name, r.pass])).toEqual([
      ["inc-from-five", true],
      ["inc-sets-last", true],
      ["save-failure-sets-status", true],
      ["locate-reads-the-seeded-route", true],
      ["count-renders-the-seed", true],
      ["inc-adds-one", true],
      ["replay-two-clicks", true],
    ]);
  });

  it("rewrites only inside the named test", () => {
    // `inc-adds-one`, a later test, is where `{slots: {count: n` is written.
    expect(() => rewritten("count-renders-the-seed", "{slots: {count: ", "n", "5")).toThrow(
      "test count-renders-the-seed = has no {slots: {count: n there",
    );
  });

  it.each([
    ["a `given.slots` seed", "inc-from-five", "{slots: {count: ", "5", '"5"', "Int", "Text"],
    ["an `expect.slots` value", "inc-from-five", "{slots: {count: ", "6", '"51"', "Int", "Text"],
    ["an `Option` slot's seed", "inc-from-five", "last: ", "None", "5", "Option(Int)", "Int"],
    [
      "a multi-step seed",
      "save-failure-sets-status",
      "{slots: {count: ",
      "3",
      '"3"',
      "Int",
      "Text",
    ],
    [
      "a multi-step expectation",
      "save-failure-sets-status",
      "{slots: {status: ",
      '"disk full"',
      "404",
      "Text",
      "Int",
    ],
    ["a tile-test seed", "count-renders-the-seed", "{slots: {count: ", "5", '"5"', "Int", "Text"],
    ["a property-test seed", "inc-adds-one", "{slots: {count: ", "n", "n.show", "Int", "Text"],
    [
      "a `slots-equal` value",
      "replay-two-clicks",
      "{slots-equal: {count: ",
      "2",
      '"2"',
      "Int",
      "Text",
    ],
    [
      "a route seed's `hash`",
      "locate-reads-the-seeded-route",
      "hash: ",
      'Some("top")',
      '"top"',
      "Option(Text)",
      "Text",
    ],
    [
      "a route seed's `params` value",
      "locate-reads-the-seeded-route",
      'params: {"id": ',
      '"7"',
      "7",
      "Text",
      "Int",
    ],
  ])("stops the build at %s of the wrong type", (_, test, before, value, wrong, want, got) => {
    const { source, line, col } = rewritten(test, before, value, wrong);
    const r = build(source);
    expect(r.kind).toBe("fail");
    if (r.kind !== "fail") return;
    expect(r.errors.map((e) => [e.code, e.message, e.pos.line, e.pos.col])).toEqual([
      ["E0201", `Expected ${want} but got ${got}`, line, col],
    ]);
  });
});
