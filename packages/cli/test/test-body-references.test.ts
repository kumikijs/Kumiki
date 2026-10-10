import { readFileSync, writeFileSync } from "node:fs";
import { findReferences, load, renameDef, testFile } from "@kumikijs/cli";
import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { beforeEach, describe, expect, it } from "vitest";
import { seedCopy } from "./helpers/files.ts";

const EXAMPLE = feature("173-test-body-references");
const TEST = "add-shouts-and-persists";

/** The text of the example's test definition; the header comment mentions the names too. */
function testDef(source: string): string {
  return source.slice(source.indexOf(`test ${TEST} =`));
}

const errorsOf = (source: string): string[] =>
  check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => `${e.code} ${e.message}`);

/** The 1-based line of the one line of `source` that contains `text`. */
function lineOf(source: string, text: string): number {
  const lines = source.split("\n");
  expect(lines.filter((l) => l.includes(text))).toHaveLength(1);
  return lines.findIndex((l) => l.includes(text)) + 1;
}

describe("a name a test body writes", () => {
  let path: string;
  beforeEach(() => {
    path = seedCopy(EXAMPLE, "app.kumiki");
  });

  it.each([
    { qname: "effect.persist", to: "save", written: "effects: [save(<slots.items>)]" },
    { qname: "fn.shout", to: "yell", written: 'slots: {draft: yell("Buy")}' },
    { qname: "slot.items", to: "todos", written: "persist(<slots.todos>)" },
    { qname: "slot.draft", to: "text", written: 'slots: {text: shout("Buy")}' },
  ])("$qname: refs lists the test, and rename rewrites it there", {
    timeout: 30_000,
  }, async ({ qname, to, written }) => {
    expect(findReferences(load(path), qname).map((r) => r.qname)).toContain(`test.${TEST}`);

    renameDef(path, qname, to);
    const source = readFileSync(path, "utf8");
    expect(testDef(source)).toContain(written);
    expect(errorsOf(source)).toEqual([]);
    expect((await testFile(path)).map((r) => `${r.name}:${r.pass}`)).toEqual([`${TEST}:true`]);
  });

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

    it.each([
      {
        key: "slot.items, an episode-test's `slots-equal` key",
        qname: "slot.items",
        to: "todos",
        at: "slots-equal: {items:",
        written: 'expect = {slots-equal: {todos: ["Buy!"]}, no-panics: true}',
      },
      {
        key: "effect.persist, an episode-test's `mocks` key",
        qname: "effect.persist",
        to: "save",
        at: "mocks  = {persist: ignore}",
        written: "mocks  = {save: ignore}",
      },
    ])("$key: refs lists the key, and rename rewrites it", ({ qname, to, at, written }) => {
      const before = withTest(REPLAY);
      expect(findReferences(load(path), qname)).toContainEqual({
        qname: "test.replay-adds",
        layer: "test",
        name: "replay-adds",
        line: lineOf(before, at),
      });

      renameDef(path, qname, to);
      const after = readFileSync(path, "utf8");
      expect(after).toContain(written);
      expect(errorsOf(after)).toEqual([]);
    });

    it("effect.persist, also a reducer-test's `given.mocks` key: rename rewrites both", () => {
      // Rewriting the `expect.effects` entry without the `mocks` key would leave a mock for an
      // effect that no longer exists.
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
      // `{items}` is the slot as the key and the generated value as the value, in one token.
      // Rewritten for the slot, `{todos}` would seed the slot with itself and stop reading the
      // generator, in a file that still checks.
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
