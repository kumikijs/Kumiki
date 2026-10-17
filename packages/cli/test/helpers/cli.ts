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
export const TWO_SPAWNS = { timeout: 2 * CHILD_TIMEOUT_MS + 10_000 };

export type CliResult = { stdout: string; stderr: string; out: string; code: number };

export function runCli(args: readonly string[], options: { input?: string } = {}): CliResult {
  const res = spawnSync(process.execPath, [...CLI_ARGV, ...args], {
    encoding: "utf8",
    input: options.input,
    timeout: CHILD_TIMEOUT_MS,
  });
  if ((res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    throw new Error(
      `\`kumiki ${args.join(" ")}\` was stopped after ${CHILD_TIMEOUT_MS} ms, the time a test allows one CLI process`,
    );
  }
  // A child that never started or was killed has no status; reporting it as a failure exit would satisfy `code: 1` assertions without the CLI having run.
  if (res.error) throw res.error;
  return {
    stdout: res.stdout,
    stderr: res.stderr,
    out: `${res.stdout}${res.stderr}`,
    code: res.status ?? Number.NaN,
  };
}
