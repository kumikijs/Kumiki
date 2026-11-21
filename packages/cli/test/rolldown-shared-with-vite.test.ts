import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `kumiki build` links with rolldown directly, and vite (also a CLI dependency) brings its own;
// two copies mean two native toolchains in every install.
const cliManifest = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const fromCli = createRequire(cliManifest);
const viteManifest = fromCli.resolve("vite/package.json");
const fromVite = createRequire(viteManifest);

const rolldownRange = (path: string): string | undefined =>
  JSON.parse(readFileSync(path, "utf8")).dependencies?.rolldown;
const rolldownDir = (from: NodeJS.Require): string =>
  realpathSync(dirname(from.resolve("rolldown/package.json")));

describe("the rolldown kumiki build links with", () => {
  it("is the copy the CLI's vite runs on", () => {
    expect(rolldownDir(fromCli)).toBe(rolldownDir(fromVite));
  });

  it("is declared with the range vite declares, so an install resolves one copy", () => {
    expect(rolldownRange(cliManifest)).toBe(rolldownRange(viteManifest));
  });
});
