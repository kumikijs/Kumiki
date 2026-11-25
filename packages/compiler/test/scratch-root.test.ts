import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchRoot } from "./helpers/scratch.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

let root = "";
/** Whether a test saw the root while it existed; "gone" means nothing until one has. */
let seen = false;

describe("a test file's scratch root", () => {
  // Registered before scratchRoot's own hook, so it stands for an earlier run under the same pid.
  beforeAll(() => {
    mkdirSync(join(root, "left-over"), { recursive: true });
  });
  root = scratchRoot(import.meta.url);

  it("sits under test/test-tmp, named after the file and the process", () => {
    expect(root).toBe(join(TEST_DIR, "test-tmp", `scratch-root-${process.pid}`));
  });

  it("is empty when the file's tests start", () => {
    seen = existsSync(root);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("once the tests that asked for it are done", () => {
  it("the scratch root is gone", () => {
    expect(seen).toBe(true);
    expect(existsSync(root)).toBe(false);
  });
});
