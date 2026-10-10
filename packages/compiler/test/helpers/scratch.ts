import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";

/**
 * The calling test file's own scratch directory, `test-tmp/<file>-<pid>` beside it: empty when
 * the file's first test starts and removed after its last, pass or fail. Write under it from a
 * test or a hook, not at collection: a file that `-t` filters out entirely runs no hooks.
 *
 * It sits under the package because what is written there imports `@kumikijs/runtime` by name.
 * It is the file's alone, so removing it never reaches a directory another worker is writing.
 */
export function scratchRoot(testFileUrl: string): string {
  const file = fileURLToPath(testFileUrl);
  const root = join(dirname(file), "test-tmp", `${basename(file, ".test.ts")}-${process.pid}`);
  beforeAll(() => {
    // The name repeats whenever the pid does: whatever is there is an earlier run's.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
