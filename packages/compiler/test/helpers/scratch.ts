// Where a test file writes what it generates — a compiled module it then
// `import()`s, a declaration file it hands `tsc`, a project tree it resolves
// against — and when that goes.

import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";

/**
 * The calling test file's own scratch directory, `test-tmp/<file>-<pid>` beside
 * it: empty when the file's first test starts and removed after its last, pass
 * or fail. Call it once where the file sets up, passing `import.meta.url`, and
 * `mkdtempSync` under what it returns — from a test or a hook, not while the
 * file is being collected: the root is made by a `beforeAll`, because a file
 * that `-t` filters out entirely is collected but runs no hooks, and a root
 * made during collection would outlive it.
 *
 * It sits under the package rather than the OS temp dir because the modules
 * written into it import `@kumikijs/runtime` by name, and Node resolves that
 * from the importing file's directory upward.
 *
 * The root is the file's alone — named after the file and the process running
 * it — so that emptying and removing it can never reach a directory another
 * worker is writing. That is also why nothing clears `test-tmp` as a whole:
 * files run in parallel, and one starting would delete the scratch of those
 * running beside it. Nothing reads a scratch directory once its file is done.
 *
 * The tests that `import()` what they write here carry a 30 s timeout of their
 * own against the package's 5 s default. On 4 Linux cores at a load average of
 * 9–21 from other work, a load takes 0.6 s as the first in a file run alone and
 * 0.1–0.4 s inside the whole package suite, with the runtime's and the Vite
 * plugin's suites running beside it or not. The margin is for machine load —
 * more workers than cores, other packages' suites under `turbo run` — which
 * stretches every load alike and which no fixed number covers; `--maxWorkers`
 * is what bounds it. A `test-tmp` that grows run over run is not among the
 * things it has to cover: each file removes its own.
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
