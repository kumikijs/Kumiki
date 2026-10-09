// Where this package's tests write what they generate, and when it goes.
//
// `test/test-tmp` is gitignored, so a directory nothing removes stays there
// for good and the next run adds its own beside it. `scratchRoot` gives each
// test file a root of its own and removes it when the file is done; these hold
// it to that, and hold every test file here to going through it.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchRoot } from "./helpers/scratch.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

let root = "";

describe("a test file's scratch root", () => {
  // What an earlier process under the same pid could have left there: the
  // root's name repeats across runs whenever the pid does. Registered first,
  // so it runs before the hook `scratchRoot` registers.
  beforeAll(() => {
    mkdirSync(join(root, "left-over"), { recursive: true });
  });
  root = scratchRoot(import.meta.url);

  it("sits under test/test-tmp, named after the file and the process", () => {
    // Under the package, so a module written here resolves `@kumikijs/runtime`.
    expect(root).toBe(join(TEST_DIR, "test-tmp", `scratch-root-${process.pid}`));
  });

  it("is empty when the file's tests start", () => {
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("once the tests that asked for it are done", () => {
  it("the scratch root is gone", () => {
    expect(root).not.toBe("");
    expect(existsSync(root)).toBe(false);
  });
});

/** Every `.ts` file under `test/` but `test-tmp`, relative to `test/`. */
function sources(dir = TEST_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // Other workers create and remove directories in there while this runs.
    if (entry.isDirectory()) return entry.name === "test-tmp" ? [] : sources(path);
    return entry.name.endsWith(".ts") ? [relative(TEST_DIR, path)] : [];
  });
}

describe("the test files in this package", () => {
  // The helper names the directory, and this file names it to check for it.
  const OWNERS = new Set([join("helpers", "scratch.ts"), "scratch-root.test.ts"]);

  it("take their scratch directory from scratchRoot", () => {
    const files = sources().filter((f) => !OWNERS.has(f));
    // The walk found the suite, so an empty list below says something.
    expect(files.length).toBeGreaterThan(80);
    const ownRoots = files.filter((f) =>
      readFileSync(join(TEST_DIR, f), "utf8").includes('"test-tmp"'),
    );
    expect(ownRoots).toEqual([]);
  });
});
