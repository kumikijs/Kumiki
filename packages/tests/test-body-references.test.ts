// The names a test body writes (testing.md §8.1.1) are references like any
// other, so `kumiki refs` lists the test, and `kumiki rename` rewrites a name
// the test wrote as an identifier: a call, an `expect.effects` entry, a
// `<slots.X>`. A name written as a record key has no position of its own, and
// `rename` refuses it (ai-edit.md §9.2).
//
// Each case renames one of the three identifiers in the example and asks what
// the example promises: the test was a referrer, the new name now stands where
// the test wrote the old one, and the file still checks with a test that still
// passes. The last gives the test a `mocks` key for an effect it also names as
// an identifier, and asks that the rename is refused rather than half done.

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findReferences, load, renameDef, testFile } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "173-test-body-references.kumiki");
const TEST = "add-shouts-and-persists";

const CASES = [
  { qname: "effect.persist", to: "save", written: "effects: [save(<slots.items>)]" },
  { qname: "fn.shout", to: "yell", written: 'slots: {draft: yell("Buy")}' },
  { qname: "slot.items", to: "todos", written: "persist(<slots.todos>)" },
];

/** The text of the example's test definition — the header comment mentions the names too. */
function testDef(source: string): string {
  return source.slice(source.indexOf(`test ${TEST} =`));
}

describe("a name a test body writes", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-test-body-refs-"));
    path = join(dir, "app.kumiki");
    copyFileSync(EXAMPLE, path);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  for (const c of CASES) {
    it(`${c.qname}: refs lists the test, and rename rewrites it there`, {
      timeout: 30_000,
    }, async () => {
      expect(findReferences(load(path), c.qname).map((r) => r.qname)).toContain(`test.${TEST}`);

      renameDef(path, c.qname, c.to);
      const source = readFileSync(path, "utf8");
      expect(testDef(source)).toContain(c.written);
      const errors = check(parse(lex(source))).filter((e) => e.severity !== "warning");
      expect(errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
      expect((await testFile(path)).map((r) => `${r.name}:${r.pass}`)).toEqual([`${TEST}:true`]);
    });
  }

  it("effect.persist, also a `mocks` key: rename refuses it and leaves the file as it was", () => {
    // With the mock, the test writes `persist` twice: as an `expect.effects`
    // entry, which has a position, and as a `mocks` key, which has none.
    // Rewriting the one without the other would leave a mock for an effect
    // that no longer exists.
    const source = readFileSync(path, "utf8").replace(
      "target: AddForm}}",
      'target: AddForm}, mocks: {persist: err("disk full")}}',
    );
    writeFileSync(path, source);
    expect(testDef(source)).toContain('mocks: {persist: err("disk full")}');
    const errors = check(parse(lex(source))).filter((e) => e.severity !== "warning");
    expect(errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
    expect(findReferences(load(path), "effect.persist").map((r) => r.qname)).toContain(
      `test.${TEST}`,
    );

    expect(() => renameDef(path, "effect.persist", "save")).toThrow(
      `Cannot rename effect.persist: it is named in a position with no rewritable identifier (test.${TEST}).`,
    );
    expect(readFileSync(path, "utf8")).toBe(source);
  });
});
