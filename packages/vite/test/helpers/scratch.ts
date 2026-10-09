// Where a test file writes the projects it has Vite build and serve, and when
// they go.

import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";

/**
 * The calling test file's own scratch directory, `test-tmp/<file>-<pid>` beside
 * it: empty when the file's first test starts and removed after its last, pass
 * or fail. Call it once where the file sets up, passing `import.meta.url`, and
 * `mkdtempSync` under what it returns from a test or a hook: the root is made
 * by a `beforeAll`, since a file `-t` filters out entirely runs no hooks.
 *
 * It sits under the package because the projects written into it import
 * `@kumikijs/runtime` by name and resolve it from the workspace. It is the
 * file's alone, so removing it never reaches a directory another worker is
 * using. The compiler's tests keep the same rule in their own
 * `test/helpers/scratch.ts`; a package's typecheck takes in nothing outside the
 * package, so the two cannot share one file.
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
