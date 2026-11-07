import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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

/**
 * A spawned CLI's environment: `env` merged over `process.env`, where spawn's own `env` would
 * replace it. `KUMIKI_EPISODE_LOG` is not inherited, so a run a test spawns never appends to a
 * log the developer's shell names; a test that wants one passes it in `env`.
 */
function childEnv(env: Record<string, string> = {}): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  delete inherited.KUMIKI_EPISODE_LOG;
  return { ...inherited, ...env };
}

/** Spawn the CLI with `args` and wait for it to exit, in the environment `childEnv` describes. */
export function runCli(
  args: readonly string[],
  options: { input?: string; env?: Record<string, string> } = {},
): CliResult {
  const res = spawnSync(process.execPath, [...CLI_ARGV, ...args], {
    encoding: "utf8",
    input: options.input,
    timeout: CHILD_TIMEOUT_MS,
    env: childEnv(options.env),
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

/** A CLI child left running by `spawnCli`. */
export type CliChild = {
  readonly args: readonly string[];
  /** Everything the child has written to stdout so far. */
  readonly stdout: string;
  /** Everything the child has written to stderr so far. */
  readonly stderr: string;
  /** How the child ended (`exited 1`, `exited SIGTERM`, `failed to start: …`); `undefined` while it runs. */
  readonly ended: string | undefined;
  /** Kill the child if it is still running, and resolve once it has exited. */
  stop(): Promise<void>;
};

/** How long `stop` waits after SIGTERM before it sends SIGKILL. */
const KILL_GRACE_MS = 5_000;

/**
 * Spawn the CLI with `args` for a verb that keeps running (`dev`, `test --watch`), in the
 * environment `childEnv` describes. Wait on its output with `waitFor`, and `stop` it in a
 * `finally`, so a failing test never leaves the child running.
 */
export function spawnCli(
  args: readonly string[],
  options: { env?: Record<string, string> } = {},
): CliChild {
  const child = spawn(process.execPath, [...CLI_ARGV, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv(options.env),
  });
  let stdout = "";
  let stderr = "";
  let ended: string | undefined;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (e) => {
    ended ??= `failed to start: ${e.message}`;
  });
  // `close` rather than `exit`: by then the child's output has all been read.
  child.on("close", (code, signal) => {
    ended ??= `exited ${signal ?? code}`;
  });
  return {
    args,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    get ended() {
      return ended;
    },
    async stop() {
      if (ended !== undefined || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill();
      // A child that ignores SIGTERM would otherwise hold the test until vitest gives up on it.
      const force = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    },
  };
}

/**
 * Wait until `done` holds. Fails with everything the child has written when it ends first, or
 * when `ms` passes; a test's timeout must leave room for each of its waits, so that the wait
 * fails with the child's output instead of vitest abandoning the test.
 */
export async function waitFor(
  cli: CliChild,
  done: () => boolean,
  what: string,
  ms = CHILD_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    const why =
      cli.ended ?? (Date.now() > deadline ? `was still running after ${ms} ms` : undefined);
    if (why !== undefined) {
      throw new Error(
        `kumiki ${cli.args.join(" ")} ${why} before ${what}\n` +
          `--- stdout\n${cli.stdout}\n--- stderr\n${cli.stderr}`,
      );
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
