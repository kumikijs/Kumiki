// An ownership lock covers every definition an op creates, removes or
// rewrites — not only the name the verb was given. Otherwise an agent refused
// a direct `replace` / `remove` can reach the same definition through a
// cascade or a rename.

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lockDef, patchApplyFile, readOpLog, removeDef, renameDef } from "@kumikijs/cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const COUNTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../examples/apps/01-counter/app.kumiki",
);

let dir = "";
let file = "";
let prevAuthor: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-lock-touched-"));
  file = join(dir, "c.kumiki");
  copyFileSync(COUNTER, file);
  prevAuthor = process.env.KUMIKI_AUTHOR;
});
afterEach(() => {
  if (prevAuthor === undefined) delete process.env.KUMIKI_AUTHOR;
  else process.env.KUMIKI_AUTHOR = prevAuthor;
  rmSync(dir, { recursive: true, force: true });
});

const as = (agent: string): void => {
  process.env.KUMIKI_AUTHOR = agent;
};

/** Runs `op` as agent:b and asserts it was refused with nothing written. */
const refusedUnchanged = (op: () => unknown, message: RegExp): void => {
  const source = readFileSync(file, "utf8");
  const logged = readOpLog(file).length;
  as("agent:b");
  expect(op).toThrowError(message);
  expect(readFileSync(file, "utf8")).toBe(source);
  expect(readOpLog(file)).toHaveLength(logged);
};

describe("remove --cascade", () => {
  it("is refused when a cascaded dependent is locked by another agent", () => {
    lockDef(file, "agent:a", "reducer.*,tile.*");
    refusedUnchanged(
      () => removeDef(file, "slot.count", true),
      /lock violation: reducer\.dec is locked by agent:a/,
    );
    // The owner of the dependents can still cascade.
    as("agent:a");
    expect(removeDef(file, "slot.count", true).removed).toContain("reducer.dec");
  });
});

describe("rename", () => {
  it("is refused when the new name is locked by another agent", () => {
    lockDef(file, "agent:a", "slot.todos*");
    refusedUnchanged(
      () => renameDef(file, "slot.count", "todos"),
      /lock violation: slot\.todos is locked by agent:a/,
    );
  });

  it("is refused when it would rewrite a definition locked by another agent", () => {
    lockDef(file, "agent:a", "reducer.*,tile.*");
    refusedUnchanged(
      () => renameDef(file, "slot.count", "total"),
      /lock violation: reducer\.dec is locked by agent:a/,
    );
  });
});

describe("patch apply", () => {
  it("replays a cascade through the same check", () => {
    lockDef(file, "agent:a", "tile.App");
    const bundle = join(dir, "ops.jsonl");
    writeFileSync(
      bundle,
      `${JSON.stringify({ op: "remove", layer: "slot", name: "count", cascade: true })}\n`,
    );
    refusedUnchanged(
      () => patchApplyFile(file, bundle),
      /lock violation: tile\.App is locked by agent:a/,
    );
    expect(existsSync(`${file}.kumiki-ops.jsonl`)).toBe(false);
  });
});
