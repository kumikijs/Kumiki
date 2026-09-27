// Regression: a tile-test compares every field its expected node states
// (testing.md §8.4). The snapshot compared only `kind`, `text` and `children`,
// so an expectation with the wrong `src`, `to`, `value`, `checked` or
// `options` passed. The example's tests are run as written, then with each
// stated field written wrong, through the same compile-and-run path
// `kumiki test` uses.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFile } from "@kumikijs/cli";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "160-tile-test-content-fields.kumiki");
const SOURCE = readFileSync(EXAMPLE, "utf8");
const TMP = join(here, ".smoke-tmp", "tile-test-content-fields");
mkdirSync(TMP, { recursive: true });

/** The example with one literal of one test's `expect` replaced. */
async function runWith(test: string, from: string, to: string) {
  const head = `test ${test} =`;
  const start = SOURCE.indexOf(head);
  const end = SOURCE.indexOf("\ntest ", start + head.length);
  const block = SOURCE.slice(start, end === -1 ? undefined : end);
  const expectLine = block.split("\n").find((l) => l.trim().startsWith("expect ="));
  if (!expectLine?.includes(from)) throw new Error(`${test}'s expect has no ${from}`);
  const path = join(TMP, `${test}.kumiki`);
  writeFileSync(path, SOURCE.replace(expectLine, expectLine.replace(from, to)));
  const results = await testFile(path);
  const result = results.find((r) => r.name === test);
  if (!result) throw new Error(`no result for ${test}`);
  return result;
}

describe("a tile-test compares the fields its expected node states", () => {
  // Each case below starts from a test that passes as written: the example
  // states only what its tiles render, and leaves the rest (the placeholder
  // `Name` renders, the `{pad: …}` on `Card`) out of the comparison.
  let asWritten: Map<string, boolean>;
  beforeAll(async () => {
    asWritten = new Map((await testFile(EXAMPLE)).map((r) => [r.name, r.pass]));
  });

  it.each([
    ["pic-src", '"/avatar.png"', '"/WRONG.png"', "image.src", "/WRONG.png", "/avatar.png"],
    ["nav-to", '"/home"', '"/WRONG"', "link.to", "/WRONG", "/home"],
    ["agree-checked", "value=true", "value=false", "check.checked", false, true],
    ["name-field", '"Grace"', '"WRONG"', "input.value", "WRONG", "Grace"],
    [
      "size-options",
      ', {label: "L", value: "l"}]',
      "]",
      "select.options",
      [{ label: "S", value: "s" }],
      [
        { label: "S", value: "s" },
        { label: "L", value: "l" },
      ],
    ],
    ["card-children", 'to="/home"', 'to="/WRONG"', "column[1].to", "/WRONG", "/home"],
  ])("fails %s when %s is written %s, at %s", async (test, from, to, diffAt, exp, act) => {
    expect(asWritten.get(test)).toBe(true);
    const r = await runWith(test, from, to);
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe(diffAt);
    expect(r.leaf).toEqual({ expected: exp, actual: act });
  });

  it("prints the compared fields on the expected / actual lines", async () => {
    const r = await runWith("nav-to", '"/home"', '"/WRONG"');
    expect(r.expected).toBe('link("Home", to="/WRONG")');
    expect(r.actual).toBe('link("Home", to="/home")');
  });
});
