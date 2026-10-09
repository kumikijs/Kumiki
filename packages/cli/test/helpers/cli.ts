import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The CLI's TypeScript entry — the tests run the source, so no build is needed first. */
const CLI_PATH = resolve(here, "../../src/kumiki.ts");

export const CLI_ARGV: readonly string[] = [
  "--import",
  pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
  CLI_PATH,
];
