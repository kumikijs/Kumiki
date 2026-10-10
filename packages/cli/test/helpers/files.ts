import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, type Store } from "@kumikijs/cli";
import { onTestFinished } from "vitest";

/** The `app` clause block of a fixture whose root tile is `App`. */
export const APP_A = `app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** A fresh directory under the OS temp dir, removed when the current test finishes. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiki-cli-test-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write `source` to `name` in a fresh temp directory; return the file's path. */
export function seed(source: string, name = "app.kumiki"): string {
  const file = join(tempDir(), name);
  writeFileSync(file, source);
  return file;
}

/** Write `lines`, newline-terminated, to `name` in a fresh temp directory; return its path. */
export function seedLines(lines: readonly string[], name = "in.kumiki"): string {
  return seed(`${lines.join("\n")}\n`, name);
}

/** Copy `src` into a fresh temp directory, so a write verb can change the copy. */
export function seedCopy(src: string, name = "input.kumiki"): string {
  const file = join(tempDir(), name);
  copyFileSync(src, file);
  return file;
}

/** Load `source` as the store of a file holding it. */
export function storeOf(source: string): Store {
  return load(seed(source));
}
