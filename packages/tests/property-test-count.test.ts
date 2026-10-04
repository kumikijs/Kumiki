// A property-test's `count` is a whole number, 1 or more (testing.md §8.3.1).
// Example 171's tests are run as written, then with `once`'s count written as
// each literal that is not one, through the same compile-and-run path
// `kumiki test` uses.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { ParseError } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "171-property-test-count.kumiki");
const SOURCE = readFileSync(EXAMPLE, "utf8");
const TMP = join(here, ".smoke-tmp", "property-test-count");
mkdirSync(TMP, { recursive: true });

/**
 * The example with `once`'s `count = 1` written as `count = <count>`, and the
 * line:col of that literal, where a parse error reports it.
 */
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
    const path = join(TMP, `count-${count}.kumiki`);
    writeFileSync(path, source);
    const refusal = await testFile(path).then(
      (results) => results.map((r) => `${r.name}: ${r.pass ? "PASS" : "FAIL"}`),
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(ParseError);
    expect((refusal as ParseError).message).toBe(
      `Parse error at ${line}:${col}: property-test "once" count must be a whole number, 1 or more (got ${count})`,
    );
  });
});
