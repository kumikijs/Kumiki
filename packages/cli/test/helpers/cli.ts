import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The CLI's TypeScript entry — the tests run the source, so no build is needed first. */
const CLI_PATH = resolve(here, "../../src/kumiki.ts");

/**
 * The arguments that start the CLI under `process.execPath`, ahead of the verb.
 *
 * `node --import tsx` rather than `npx tsx` through a shell: the same
 * interpreter without npm's per-call resolution or a shell in between, which
 * cost about half a second on every one of the few hundred processes these
 * tests start. The loader is resolved to a URL here so the child finds it
 * whatever its working directory. With no shell, each argument reaches the CLI
 * as written — no quoting for `(`, spaces or `*`.
 */
export const CLI_ARGV: readonly string[] = [
  "--import",
  pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
  CLI_PATH,
];

// Each run pays for a node + tsx module load, not for compiler work, so the
// limits are generous enough to survive a saturated machine running the rest
// of the suite alongside it.
//
// The child gets its own: `spawnSync` blocks the worker's event loop, so a hung
// CLI cannot be interrupted by vitest's timeout — the run would stop rather
// than fail. The child's limit is the shorter one so it always fires first.
const CHILD_TIMEOUT_MS = 60_000;

/** The options for a test that runs the CLI with `runCli`. */
export const SPAWN = { timeout: 70_000 };

/** Run the CLI with `args` and wait for it to exit. */
export function runCli(args: readonly string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync(process.execPath, [...CLI_ARGV, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  // A process that never started, or one a signal killed, has `status: null`.
  // Folding that into 1 would make every `toBe(1)` pass without the CLI
  // running at all, which is the one result a test about exit codes must not
  // accept.
  if (res.error) throw res.error;
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: res.status ?? Number.NaN,
  };
}
