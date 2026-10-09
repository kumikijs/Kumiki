import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApp as cliLoadApp } from "@kumikijs/cli";
import { resolveCapabilities } from "@kumikijs/compiler/node";
import type { AppShape } from "@kumikijs/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(here, "..", ".smoke-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

export async function loadApp(kumikiPath: string): Promise<AppShape> {
  return cliLoadApp(readFileSync(kumikiPath, "utf8"), resolveCapabilities(kumikiPath), {
    sourcePath: kumikiPath,
    moduleDir: TMP_ROOT,
  });
}

/**
 * The same pipeline from a source string rather than a file. Tests that vary one prop at a time need the source in the test body, next to what it asserts about the DOM — a fixture file per row would put the two halves of the claim in different files.
 */
export async function loadSource(src: string, capabilities: string[] = []): Promise<AppShape> {
  return cliLoadApp(src, capabilities, { moduleDir: TMP_ROOT });
}
