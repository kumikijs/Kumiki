// The names a test body writes (testing.md §8.1.1) are references like any
// other: `refs` lists the test, and `rename` rewrites the name where the test
// wrote it (ai-edit.md §9.2). An `expect.effects` entry is the effect, at its
// callee; a fn called in a `given` value is the fn; and a `<slots.X>` wildcard
// is the slot, at `X`.
//
// Each case renames one of the three in the example and asks what the example
// promises: the test was a referrer, the new name now stands where the test
// wrote the old one, and the file still checks with a test that still passes.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
});
