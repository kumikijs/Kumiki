import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CLI_PATH = resolve(here, "../../src/kumiki.ts");

export const CLI_ARGV: readonly string[] = [
  "--import",
  pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
  CLI_PATH,
];

// spawnSync blocks the worker, so vitest's timeout cannot interrupt a hung child; the child's own limit must fire first.
export const CHILD_TIMEOUT_MS = 60_000;
export const SPAWN = { timeout: CHILD_TIMEOUT_MS + 10_000 };

export type CliResult = { stdout: string; stderr: string; out: string; code: number };

/**
 * Spawn the CLI with `args`. `env` is merged over `process.env`, where spawn's own `env` would
 * replace it. `KUMIKI_EPISODE_LOG` is not inherited, so a run a test spawns never appends to a
 * log the developer's shell names; a test that wants one passes it in `env`.
 */
export function runCli(
  args: readonly string[],
  options: { input?: string; env?: Record<string, string> } = {},
): CliResult {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  delete inherited.KUMIKI_EPISODE_LOG;
  const res = spawnSync(process.execPath, [...CLI_ARGV, ...args], {
    encoding: "utf8",
    input: options.input,
    timeout: CHILD_TIMEOUT_MS,
    env: { ...inherited, ...options.env },
  });
  // A child that never started or was killed has no status; reporting it as a failure exit would satisfy `code: 1` assertions without the CLI having run.
  if (res.error) throw res.error;
  return {
    stdout: res.stdout,
    stderr: res.stderr,
    out: `${res.stdout}${res.stderr}`,
    code: res.status ?? Number.NaN,
  };
}
