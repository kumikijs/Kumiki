import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The CLI's TypeScript entry — the tests run the source, so no build is needed first. */
export const CLI_PATH = resolve(here, "../../src/kumiki.ts");

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
