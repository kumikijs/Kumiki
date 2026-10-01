// Regression: a tile-test compares every field its expected node states
// (testing.md §8.4). The snapshot compared only `kind`, `text` and `children`,
// so an expectation with the wrong `src`, `to`, `value`, `checked`,
// `options`, `alt` or `disabled` passed. The example's tests are run as
// written, then with each stated field written wrong, through the same
// compile-and-run path `kumiki test` uses. The boundary cases on hand-built
// nodes are in `packages/runtime/test/tile-test-fields.test.ts`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFixFromTest, testFile } from "@kumikijs/cli";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "160-tile-test-content-fields.kumiki");
const SOURCE = readFileSync(EXAMPLE, "utf8");
const TMP = join(here, ".smoke-tmp", "tile-test-content-fields");
mkdirSync(TMP, { recursive: true });

/** Write `source` beside the example under `test`'s name and run that test. */
async function runSource(test: string, source: string) {
  const path = join(TMP, `${test}.kumiki`);
  writeFileSync(path, source);
  const results = await testFile(path);
  const result = results.find((r) => r.name === test);
  if (!result) throw new Error(`no result for ${test}`);
  return { path, result };
}

/** The example with the first `from` at or after `start` replaced by `to`. */
function editedFrom(start: number, from: string, to: string): string {
  const hit = SOURCE.indexOf(from, start);
  if (start === -1 || hit === -1) throw new Error(`the example has no ${from} there`);
  return SOURCE.slice(0, hit) + to + SOURCE.slice(hit + from.length);
}

/** The example with the first `from` after `at` replaced by `to`. */
function edited(at: string, from: string, to: string): string {
  const start = SOURCE.indexOf(at);
  if (start === -1) throw new Error(`the example has no ${at}`);
  return editedFrom(start + at.length, from, to);
}

/** The example with one literal of one test's `expect` replaced. */
async function runWith(test: string, from: string, to: string) {
  // Anchored at the test's own `expect =` line, so neither another test's
  // identical line nor this test's `given` is the one edited.
  const expectAt = SOURCE.indexOf("expect =", SOURCE.indexOf(`test ${test} =`));
  const line = SOURCE.slice(expectAt, SOURCE.indexOf("\n", expectAt));
  if (!line.includes(from)) throw new Error(`${test}'s expect has no ${from}`);
  return (await runSource(test, editedFrom(expectAt, from, to))).result;
}

describe("a tile-test compares the fields its expected node states", () => {
  // Each case below starts from a test that passes as written: the example
  // states only what its tiles render, and what it leaves out (the
  // placeholder `Name` renders, `Go`'s `{variant: …}`, `People`'s keys) is
  // not compared.
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
    ["pic-src", 'alt="avatar"', 'alt="WRONG"', "image.alt", "WRONG", "avatar"],
    ["card-children", 'alt="avatar"', 'alt="WRONG"', "column[0].alt", "WRONG", "avatar"],
    ["go-disabled", "disabled=true", "disabled=false", "button.disabled", false, true],
  ])("fails %s when %s is written %s, at %s", async (test, from, to, diffAt, exp, act) => {
    expect(asWritten.get(test)).toBe(true);
    const r = await runWith(test, from, to);
    expect(r.pass).toBe(false);
    expect(r.diffAt).toBe(diffAt);
    expect(r.leaf).toEqual({ expected: exp, actual: act });
  });

  it("fails a disabled expectation against an enabled button, past the {…} block", async () => {
    // `go-disabled` states `{variant: "primary"}` where `Go` renders "ghost";
    // the block is styling, so the first difference is the argument.
    const source = edited("tile Go", "disabled=true", "disabled=false");
    const { result } = await runSource("go-disabled", source);
    expect(result.pass).toBe(false);
    expect(result.diffAt).toBe("button.disabled");
    expect(result.leaf).toEqual({ expected: true, actual: false });
    const { result: unstated } = await runSource(
      "go-disabled",
      edited("tile Go", ", disabled=true)", ")"),
    );
    expect(unstated.diffAt).toBe("button.disabled");
    expect(unstated.leaf).toEqual({ expected: true, actual: undefined });
  });

  it("passes a for with an implicit key against rows keyed by id", () => {
    // `people-list`'s rows are keyed `_s.show(p)`; `People` keys them by
    // `p.id`. A key is the reconciler's identity, not content.
    expect(asWritten.get("people-list")).toBe(true);
  });

  it("prints the compared fields on the expected / actual lines", async () => {
    const r = await runWith("nav-to", '"/home"', '"/WRONG"');
    expect(r.expected).toBe('link("Home", to="/WRONG")');
    expect(r.actual).toBe('link("Home", to="/home")');
  });

  it("prints only the stated fields of a node that carries more", async () => {
    // `Name` renders a placeholder that `name-field` does not state.
    const r = await runWith("name-field", '"Grace"', '"WRONG"');
    expect(r.expected).toBe('input(value="WRONG")');
    expect(r.actual).toBe('input(value="Grace")');
  });
});

describe("kumiki fix --auto-patch on a tile-test field", () => {
  // `given.slots` decides `agreed`, so rewriting the slot's initial value
  // cannot make `agree-checked` pass: a Bool leaf is not a literal to repair.
  it("proposes nothing for a non-text leaf", async () => {
    const { path } = await runSource(
      "agree-checked",
      edited("test agree-checked =", "value=true", "value=false"),
    );
    const out = await runFixFromTest(path, "agree-checked", false);
    expect(out).toMatchObject({ status: "no-patch", reason: "tile-leaf-not-text" });
  });

  it("proposes the tile's literal for a text leaf", async () => {
    const { path } = await runSource("nav-to", edited("tile Nav", 'to="/home"', 'to="/hom"'));
    const out = await runFixFromTest(path, "nav-to", false);
    if (out.status !== "proposed") throw new Error(`no proposal: ${JSON.stringify(out)}`);
    expect(out.patch.apply(readFileSync(path, "utf8"))).toContain(
      'tile Nav   = link(text="Home", to="/home")',
    );
  });
});
