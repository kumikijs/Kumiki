import { readFileSync } from "node:fs";
import { ParseError } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { testFile } from "../src/smoke.ts";
import { seed } from "./helpers/files.ts";

const EXAMPLE = feature("171-property-test-count");
const SOURCE = readFileSync(EXAMPLE, "utf8");

function withOnceCount(count: string): { source: string; line: number; col: number } {
  const once = SOURCE.indexOf("test once =");
  const m = /count\s*=\s*(\S+)/.exec(SOURCE.slice(once));
  if (once < 0 || m?.[1] !== "1") throw new Error("the example's `once` has no `count = 1`");
  const at = once + m.index + m[0].length - m[1].length;
  const before = SOURCE.slice(0, at).split("\n");
  return {
    source: `${SOURCE.slice(0, at)}${count}${SOURCE.slice(at + m[1].length)}`,
    line: before.length,
    col: (before.at(-1)?.length ?? 0) + 1,
  };
}

describe("a property-test runs the number of cases its count asks for", () => {
  it("runs one case for count = 1 and 100 when count is left out", async () => {
    const results = await testFile(EXAMPLE);
    expect(results.map((r) => [r.name, r.pass, r.cases])).toEqual([
      ["once", true, 1],
      ["hundred", true, 100],
    ]);
  });

  it.each([
    "0",
    "0.5",
    "0.50",
    "-3",
    "-0",
  ])("refuses count = %s at the literal, naming the clause", async (count) => {
    const { source, line, col } = withOnceCount(count);
    const refusal = await testFile(seed(source, "count.kumiki")).then(
      (results) => results.map((r) => `${r.name}: ${r.pass ? "PASS" : "FAIL"}`),
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(ParseError);
    expect((refusal as ParseError).message).toBe(
      `Parse error at ${line}:${col}: property-test "once" count must be a whole number, 1 or more (got ${count})`,
    );
  });
});
