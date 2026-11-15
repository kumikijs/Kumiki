import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime");

type Target = string | { readonly import?: string };
const published: Record<string, Target> = JSON.parse(
  readFileSync(join(runtimeDir, "package.json"), "utf8"),
).publishConfig.exports;

// A pattern such as `./modules/*` names no one file; modular-build.test.ts loads those.
const entries = Object.entries(published).flatMap(([subpath, target]) => {
  const file = typeof target === "string" ? target : target.import;
  return file && !file.includes("*") ? [{ subpath, file }] : [];
});

const names = (mod: object): string[] => Object.keys(mod).sort();

// Dev `exports` resolve to src, so a broken tsdown entry or `publishConfig` target would stay
// green until a published consumer, such as the compiler's parser, failed to import it.
describe("the runtime's published entry points", () => {
  it("include the subpaths the compiler imports", () => {
    expect(entries.map((e) => e.subpath)).toEqual(
      expect.arrayContaining([".", "./positive-int", "./text-distance"]),
    );
  });

  it.each(entries)("$subpath loads from $file with the names its dev export has", async (e) => {
    const built: object = await import(pathToFileURL(join(runtimeDir, e.file)).href);
    const dev: object = await import(`@kumikijs/runtime${e.subpath.slice(1)}`);
    expect(names(built).length).toBeGreaterThan(0);
    expect(names(built)).toEqual(names(dev));
  });
});
