import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchRoot } from "./helpers/scratch.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

let root = "";

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
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("once the tests that asked for it are done", () => {
  it("the scratch root is gone", () => {
    expect(root).not.toBe("");
    expect(existsSync(root)).toBe(false);
  });
});
