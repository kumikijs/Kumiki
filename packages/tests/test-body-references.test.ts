// The names a test body writes (testing.md §8.1.1) are references like any
// other, so `kumiki refs` lists the test, and `kumiki rename` rewrites each one
// where the test wrote it: a call, an `expect.effects` entry, a `<slots.X>`,
// and a record key — a `slots` / `slots-equal` key, a `mocks` key.
//
// Each case renames one of the names in the example and asks what the example
// promises: the test was a referrer, the new name now stands where the test
// wrote the old one, and the file still checks with a test that still passes.
// The cases after them write the record keys the example does not: the
// `slots-equal` and `mocks` keys of an episode-test added to it, and a
// `given.mocks` key added to its reducer-test. The last adds a property-test
// that writes a key as its own value, `{items}`, where the value is a `for-all`
// name, and asks that the rename is refused rather than rewriting the
// generated value with the slot.

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
  { qname: "slot.draft", to: "text", written: 'slots: {text: shout("Buy")}' },
];

/** The text of the example's test definition — the header comment mentions the names too. */
function testDef(source: string): string {
  return source.slice(source.indexOf(`test ${TEST} =`));
}

/** The diagnostics `source` raises, warnings aside, as `code message`. */
function errorsOf(source: string): string[] {
  return check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);
}

/** The 1-based line of the one line of `source` that contains `text`. */
function lineOf(source: string, text: string): number {
  const lines = source.split("\n");
  const at = lines.findIndex((l) => l.includes(text));
  expect(lines.filter((l) => l.includes(text))).toHaveLength(1);
  return at + 1;
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
      expect(errorsOf(source)).toEqual([]);
      expect((await testFile(path)).map((r) => `${r.name}:${r.pass}`)).toEqual([`${TEST}:true`]);
    });
  }

  describe("written as a record key", () => {
    /** Appends `test` to the example, and asks that the result checks before anything is renamed. */
    function withTest(test: string): string {
      const source = `${readFileSync(path, "utf8")}\n${test}\n`;
      writeFileSync(path, source);
      expect(errorsOf(source)).toEqual([]);
      return source;
    }

    const REPLAY = `test replay-adds =
    episode-test
        load   = "add.jsonl"
        mocks  = {persist: ignore}
        expect = {slots-equal: {items: ["Buy!"]}, no-panics: true}`;

    it("slot.items, an episode-test's `slots-equal` key: refs lists the key, and rename rewrites it", () => {
      const before = withTest(REPLAY);
      expect(findReferences(load(path), "slot.items")).toContainEqual({
        qname: "test.replay-adds",
        layer: "test",
        name: "replay-adds",
        line: lineOf(before, "slots-equal: {items:"),
      });

      renameDef(path, "slot.items", "todos");
      const after = readFileSync(path, "utf8");
      expect(after).toContain('expect = {slots-equal: {todos: ["Buy!"]}, no-panics: true}');
      expect(errorsOf(after)).toEqual([]);
    });

    it("effect.persist, an episode-test's `mocks` key: refs lists the key, and rename rewrites it", () => {
      const before = withTest(REPLAY);
      expect(findReferences(load(path), "effect.persist")).toContainEqual({
        qname: "test.replay-adds",
        layer: "test",
        name: "replay-adds",
        line: lineOf(before, "mocks  = {persist: ignore}"),
      });

      renameDef(path, "effect.persist", "save");
      const after = readFileSync(path, "utf8");
      expect(after).toContain("mocks  = {save: ignore}");
      expect(errorsOf(after)).toEqual([]);
    });

    it("effect.persist, also a reducer-test's `given.mocks` key: rename rewrites both", () => {
      // With the mock, the test writes `persist` twice: as an `expect.effects`
      // entry and as a `mocks` key. Rewriting the one without the other would
      // leave a mock for an effect that no longer exists.
      const source = readFileSync(path, "utf8").replace(
        "target: AddForm}}",
        'target: AddForm}, mocks: {persist: err("disk full")}}',
      );
      writeFileSync(path, source);
      expect(testDef(source)).toContain('mocks: {persist: err("disk full")}');
      expect(errorsOf(source)).toEqual([]);

      renameDef(path, "effect.persist", "save");
      const after = readFileSync(path, "utf8");
      expect(testDef(after)).toContain('mocks: {save: err("disk full")}');
      expect(testDef(after)).toContain("effects: [save(<slots.items>)]");
      expect(errorsOf(after)).toEqual([]);
    });

    it("slot.items, a key written as its own value that is a `for-all` name: rename refuses it", () => {
      // `{items}` is `{items: items}`, the slot as the key and the generated
      // value as the value, in one token. Rewritten for the slot, `{todos}`
      // would seed the slot with itself and stop reading the generator, in a
      // file that still checks.
      const before = withTest(`test adding-clears-the-draft =
    property-test
        for-all   = {items: List(Text)}
        given     = {slots: {items}, event: {type: ui.submit, target: AddForm}}
        invariant = run-reducer(addItem).slots.draft == ""`);
      expect(findReferences(load(path), "slot.items").map((r) => r.qname)).toContain(
        "test.adding-clears-the-draft",
      );

      expect(() => renameDef(path, "slot.items", "todos")).toThrow(
        "Cannot rename slot.items: it is named in a position with no rewritable identifier (test.adding-clears-the-draft).",
      );
      expect(readFileSync(path, "utf8")).toBe(before);
    });
  });
});
