import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { importModule } from "./helpers/module.ts";
import { removeScratch } from "./helpers/scratch.ts";

/** The generated file a load error's stack trace points at. */
function fileInStack(error: unknown): string {
  // A frame reads `at <file>:1:7` or `at <fn> (<file>:1:7)`; <file> is a path or a file URL.
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const at = /^\s*at (?:.*\()?(.+?app\.mjs)/m.exec(stack)?.[1];
  if (at === undefined) expect.fail(`no generated file in the error's stack: ${stack}`);
  return at.startsWith("file:") ? fileURLToPath(at) : at;
}

describe("a generated module imported for a test", () => {
  it("is removed once it has loaded", async () => {
    const mod = await importModule<{ where: string }>("export const where = import.meta.url;");
    expect(existsSync(fileURLToPath(mod.where))).toBe(false);
  });

  it("stays where its stack trace points when it fails to load", async () => {
    const thrown = await importModule("throw new Error('fails at load');").then(
      () => expect.fail("the module loaded"),
      (e: unknown) => e,
    );
    const file = fileInStack(thrown);
    onTestFinished(() => removeScratch(dirname(file)));
    expect((thrown as Error).message).toBe("fails at load");
    expect(existsSync(file)).toBe(true);
  });
});
