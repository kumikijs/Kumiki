import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDef,
  editDef,
  load,
  lockDef,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
} from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const COUNTER = app("01-counter");

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

/** Runs `op` as agent:b and asserts it was refused: the file byte-identical, nothing logged. */
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

  it("is allowed for the owner of the locked definitions it touches", () => {
    lockDef(file, "agent:a", "slot.todos*,reducer.*,tile.*");
    as("agent:a");
    renameDef(file, "slot.count", "todos");
    const store = load(file);
    expect(store.byQName.has("slot.todos")).toBe(true);
    expect(store.byQName.has("slot.count")).toBe(false);
    expect(readOpLog(file).at(-1)).toMatchObject({ op: "rename", name: "count", newName: "todos" });
  });
});

describe("a body that carries another definition", () => {
  beforeEach(() => lockDef(file, "agent:a", "slot.todos*,reducer.*"));

  it("replace cannot create a slot inside a locked namespace", () => {
    refusedUnchanged(
      () => replaceDef(file, "slot.count", "N = 0\n\nslot todosX : Int = 0"),
      /lock violation: slot\.todosX is locked by agent:a/,
    );
  });

  it("replace cannot create a reducer inside a locked namespace", () => {
    refusedUnchanged(
      () =>
        replaceDef(file, "slot.count", "N = 0\n\nreducer inc2 on=ui.click(IncBtn) do= count := 5"),
      /lock violation: reducer\.inc2 is locked by agent:a/,
    );
  });

  it("add cannot create a second definition inside a locked namespace", () => {
    refusedUnchanged(
      () => addDef(file, "slot", "extra", "Int = 0\n\nslot todosX : Int = 0"),
      /lock violation: slot\.todosX is locked by agent:a/,
    );
  });

  it("edit cannot create a definition inside a locked namespace", () => {
    refusedUnchanged(
      () =>
        editDef(file, "slot.count", {
          find: "= 0",
          replace: "= 0\n\nreducer inc2 on=ui.click(IncBtn) do= count := 5",
        }),
      /lock violation: reducer\.inc2 is locked by agent:a/,
    );
  });

  it("is still allowed when every definition it creates is unlocked", () => {
    as("agent:b");
    replaceDef(file, "slot.count", "N = 0\n\nslot other : Int = 0");
    expect(load(file).byQName.has("slot.other")).toBe(true);
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

describe("patch revert", () => {
  it("cannot restore a cascade member locked by another agent", () => {
    as("agent:b");
    const { opId } = removeDef(file, "slot.count", true);
    lockDef(file, "agent:a", "reducer.inc");
    refusedUnchanged(
      () => patchRevert(file, opId),
      /lock violation: reducer\.inc is locked by agent:a/,
    );
  });

  it("cannot revert a restoring add when a member of its set is locked by another agent", () => {
    as("agent:b");
    const { opId } = removeDef(file, "slot.count", true);
    const restoreId = patchRevert(file, opId);
    lockDef(file, "agent:a", "reducer.inc");
    refusedUnchanged(
      () => patchRevert(file, restoreId),
      /lock violation: reducer\.inc is locked by agent:a/,
    );
  });
});
