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

describe("a name a test body writes", () => {
  let path: string;
  beforeEach(() => {
    path = seedCopy(EXAMPLE, "app.kumiki");
  });

  it.each([
    { qname: "effect.persist", to: "save", written: "effects: [save(<slots.items>)]" },
    { qname: "fn.shout", to: "yell", written: 'slots: {draft: yell("Buy")}' },
    { qname: "slot.items", to: "todos", written: "persist(<slots.todos>)" },
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

  it("effect.persist, also a `mocks` key: rename refuses it and leaves the file as it was", () => {
    // Rewriting the positioned `expect.effects` entry without the unpositioned `mocks` key would
    // leave a mock for an effect that no longer exists.
    const source = readFileSync(path, "utf8").replace(
      "target: AddForm}}",
      'target: AddForm}, mocks: {persist: err("disk full")}}',
    );
    writeFileSync(path, source);
    expect(testDef(source)).toContain('mocks: {persist: err("disk full")}');
    expect(errorsOf(source)).toEqual([]);
    expect(findReferences(load(path), "effect.persist").map((r) => r.qname)).toContain(
      `test.${TEST}`,
    );

    expect(() => renameDef(path, "effect.persist", "save")).toThrow(
      `Cannot rename effect.persist: it is named in a position with no rewritable identifier (test.${TEST}).`,
    );
    expect(readFileSync(path, "utf8")).toBe(source);
  });
});
