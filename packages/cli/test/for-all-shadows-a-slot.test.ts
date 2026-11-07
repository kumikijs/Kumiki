import { readFileSync } from "node:fs";
import { findReferences, load, testFile } from "@kumikijs/cli";
import { feature } from "@kumikijs/examples";
import { beforeEach, describe, expect, it } from "vitest";
import { errorsOf } from "./helpers/diagnostics.ts";
import { renamed, seedCopy } from "./helpers/files.ts";

const EXAMPLE = feature("279-for-all-shadows-a-slot");
const SHADOWED = "inc-dec-roundtrips";
const UNSHADOWED = "inc-counts-past-the-slot";

/** The text of the test named `name`, up to the next definition or the end of the file. */
function testDef(source: string, name: string): string {
  const from = source.indexOf(`test ${name} =`);
  expect(from).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\ntest ", from);
  return source.slice(from, next === -1 ? undefined : next);
}

describe("a `for-all` name that is also a slot's", () => {
  let path: string;
  beforeEach(() => {
    path = seedCopy(EXAMPLE, "app.kumiki");
  });

  it("is no reference to the slot: refs lists only the definitions that read the slot", () => {
    const readers = findReferences(load(path), "slot.n").map((r) => r.qname);
    expect([...new Set(readers)]).toEqual(["tile.App", `test.${UNSHADOWED}`]);
  });

  it("is left as written by a rename of the slot, and its test still passes", {
    timeout: 30_000,
  }, async () => {
    const before = readFileSync(path, "utf8");

    const after = renamed(path, "slot.n", "limit");
    expect(testDef(after, SHADOWED)).toBe(testDef(before, SHADOWED));
    expect(errorsOf(after)).toEqual([]);
    expect((await testFile(path)).map((r) => `${r.name}:${r.pass}`)).toEqual([
      `${SHADOWED}:true`,
      `${UNSHADOWED}:true`,
    ]);
  });

  it("leaves the slot a reference where no `for-all` name shadows it, so rename rewrites it", () => {
    const after = renamed(path, "slot.n", "limit");
    expect(testDef(after, UNSHADOWED)).toContain("given     = {slots: {count: limit + k},");
    expect(testDef(after, UNSHADOWED)).toContain(
      "invariant = run-reducer(inc).slots.count == limit + k + 1",
    );
  });
});
