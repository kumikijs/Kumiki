import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDef,
  listDefs,
  load,
  lockDef,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  viewHistory,
} from "@kumikijs/cli";
import { afterEach, describe, expect, it } from "vitest";

let dir = "";
const seed = (source: string): string => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-revert-cascade-"));
  const file = join(dir, "c.kumiki");
  writeFileSync(file, source);
  return file;
};
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const logPath = (file: string): string => `${file}.kumiki-ops.jsonl`;

const qnames = (file: string): string[] =>
  listDefs(load(file))
    .map((d) => `${d.layer}.${d.name}`)
    .sort();

/** The file and its op log, byte for byte — what "nothing was written" compares. */
const snapshot = (file: string): { source: string; log: string } => ({
  source: readFileSync(file, "utf8"),
  log: readFileSync(logPath(file), "utf8"),
});

/** Rewrite one op-log entry in place, as an older version of the CLI would have logged it. */
const rewriteLogEntry = (
  file: string,
  opId: string,
  edit: (entry: Record<string, unknown>) => void,
): void => {
  const lines = readFileSync(logPath(file), "utf8").split("\n");
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    const entry = JSON.parse(line) as Record<string, unknown>;
    if (entry["op-id"] !== opId) return line;
    edit(entry);
    return JSON.stringify(entry);
  });
  writeFileSync(logPath(file), out.join("\n"));
};

/** `slot.b` with two tiles hanging off it, every body in the op log. */
const cascadeFixture = (): { file: string; removeId: string } => {
  const file = seed("slot a : Int = 0\n");
  addDef(file, "slot", "b", "Int = 1");
  addDef(file, "tile", "Show", "text(b.show)");
  addDef(file, "tile", "Page", "column(Show)");
  const { opId } = removeDef(file, "slot.b", true);
  return { file, removeId: opId };
};

/** The cascade fixture after its restore: all four definitions back, one `add` with `with`. */
const restoredFixture = (): { file: string; removeId: string; restoreId: string } => {
  const { file, removeId } = cascadeFixture();
  const restoreId = patchRevert(file, removeId);
  return { file, removeId, restoreId };
};

describe("patch revert of a cascade", () => {
  it("restores every definition the cascade removed", () => {
    const { file, removeId } = cascadeFixture();
    expect(qnames(file)).toEqual(["slot.a"]);

    patchRevert(file, removeId);

    expect(qnames(file)).toEqual(["slot.a", "slot.b", "tile.Page", "tile.Show"]);
  });

  it("logs the restore as one op", () => {
    const { file, removeId } = cascadeFixture();
    const before = readOpLog(file).length;

    const revertId = patchRevert(file, removeId);

    const log = readOpLog(file);
    expect(log).toHaveLength(before + 1);
    const op = log.at(-1)!;
    expect(op["op-id"]).toBe(revertId);
    expect(op.op).toBe("add");
    expect(`${op.layer}.${op.name}`).toBe("slot.b");
    expect(op.with?.map((d) => `${d.layer}.${d.name}`)).toEqual(["tile.Page", "tile.Show"]);
  });

  it("restores a dependent whose body no earlier op recorded", () => {
    // `tile.Show` predates the op log. The remove op itself carries its body.
    const file = seed("slot a : Int = 0\nslot b : Int = 1\ntile Show = text(b.show)\n");
    addDef(file, "tile", "Page", "column(Show)");
    const { opId } = removeDef(file, "slot.b", true);

    patchRevert(file, opId);

    expect(qnames(file)).toEqual(["slot.a", "slot.b", "tile.Page", "tile.Show"]);
    expect(readFileSync(file, "utf8")).toContain("tile Show = text(b.show)");
  });

  it("restores the body a dependent had when it was removed, even after a rename", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "b", "Int = 1");
    addDef(file, "slot", "x", "Int = 2");
    addDef(file, "tile", "Show", "text(b.show + x.show)");
    renameDef(file, "slot.x", "y");
    addDef(file, "slot", "x", "Int = 99");
    const { opId } = removeDef(file, "slot.b", true);

    patchRevert(file, opId);

    expect(readFileSync(file, "utf8")).toContain("tile Show = text(b.show + y.show)");
  });

  it("restores the body a definition had when it was removed, not its first one", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "b", "Int = 1");
    addDef(file, "tile", "Show", "text(b.show)");
    replaceDef(file, "tile.Show", 'text("b = " + b.show)');
    const { opId } = removeDef(file, "slot.b", true);

    patchRevert(file, opId);

    expect(readFileSync(file, "utf8")).toContain('tile Show = text("b = " + b.show)');
  });

  it("reverts a plain remove of a definition no earlier op recorded", () => {
    const file = seed("slot a : Int = 0\nslot b : Int = 7\n");
    const { opId } = removeDef(file, "slot.b", false);

    patchRevert(file, opId);

    expect(readFileSync(file, "utf8")).toContain("slot b : Int = 7");
  });

  it("refuses to restore when a restored name is locked by another agent", () => {
    const { file, removeId } = cascadeFixture();
    lockDef(file, "agent:other", "tile.Show");
    const before = snapshot(file);

    expect(() => patchRevert(file, removeId)).toThrowError(/lock violation: tile\.Show/);

    expect(snapshot(file)).toEqual(before);
  });

  it("writes nothing when the restore fails validation", () => {
    const { file, removeId } = cascadeFixture();
    addDef(file, "tile", "Show", 'text("new")');
    const before = snapshot(file);

    expect(() => patchRevert(file, removeId)).toThrowError(/add rejected/);

    expect(snapshot(file)).toEqual(before);
  });

  it("reverting the restore removes the same set again", () => {
    const { file, restoreId } = restoredFixture();
    expect(qnames(file)).toHaveLength(4);

    patchRevert(file, restoreId);

    expect(qnames(file)).toEqual(["slot.a"]);
  });

  it("reverting the restore removes a member that no longer depends on the named definition", () => {
    const { file, restoreId } = restoredFixture();
    replaceDef(file, "tile.Show", 'text("x")');

    const revertId = patchRevert(file, restoreId);

    expect(qnames(file)).toEqual(["slot.a"]);
    const op = readOpLog(file).find((e) => e["op-id"] === revertId)!;
    expect(op.removed).toEqual(["slot.b", "tile.Page", "tile.Show"]);
  });

  it("refuses to revert the restore when a definition outside it references a member", () => {
    const { file, restoreId } = restoredFixture();
    addDef(file, "tile", "Other", "column(Show)");
    const before = snapshot(file);

    expect(() => patchRevert(file, restoreId)).toThrowError(/tile\.Other references tile\.Show/);

    expect(snapshot(file)).toEqual(before);
  });

  it("refuses to revert the restore when a member is no longer in the file", () => {
    const { file, restoreId } = restoredFixture();
    const { opId: removedId } = removeDef(file, "tile.Page", false);
    const before = snapshot(file);

    expect(() => patchRevert(file, restoreId)).toThrowError(
      `patch revert: ${restoreId} added tile.Page, which is no longer in the file: ${removedId} removed tile.Page; nothing was written`,
    );

    expect(snapshot(file)).toEqual(before);
  });

  it("reverting the restore removes a member renamed since under its new name", () => {
    const { file, restoreId } = restoredFixture();
    renameDef(file, "tile.Page", "Home");

    const revertId = patchRevert(file, restoreId);

    expect(qnames(file)).toEqual(["slot.a"]);
    const op = readOpLog(file).find((e) => e["op-id"] === revertId)!;
    expect(op.removed).toEqual(["slot.b", "tile.Home", "tile.Show"]);
  });

  it("refuses to revert the restore when a member is locked by another agent", () => {
    const { file, restoreId } = restoredFixture();
    lockDef(file, "agent:other", "tile.Page");
    const before = snapshot(file);

    expect(() => patchRevert(file, restoreId)).toThrowError(/lock violation: tile\.Page/);

    expect(snapshot(file)).toEqual(before);
  });

  it("reads a prior body from a restore's `with` list", () => {
    const file = seed("slot a : Int = 0\nslot b : Int = 1\ntile Show = text(b.show)\n");
    const { opId } = removeDef(file, "slot.b", true);
    patchRevert(file, opId);
    const replaceId = replaceDef(file, "tile.Show", 'text("replaced")').opId;
    rewriteLogEntry(file, replaceId, (e) => {
      delete e.prev;
    });

    patchRevert(file, replaceId);

    expect(readFileSync(file, "utf8")).toContain("tile Show = text(b.show)");
  });

  it("shows the cascade and the restore in a dependent's own history", () => {
    const { file, removeId, restoreId } = restoredFixture();

    const history = viewHistory(file, "tile.Show").map((e) => e["op-id"]);

    expect(history).toContain(removeId);
    expect(history).toContain(restoreId);
  });
});

describe("patch revert of a cascade logged by an older CLI", () => {
  it("falls back to the log's bodies, and writes nothing when one is missing", () => {
    const file = seed("slot a : Int = 0\nslot b : Int = 1\ntile Show = text(b.show)\n");
    addDef(file, "tile", "Page", "column(Show)");
    const { opId } = removeDef(file, "slot.b", true);
    rewriteLogEntry(file, opId, (e) => {
      delete e.bodies;
    });
    const before = snapshot(file);

    expect(() => patchRevert(file, opId)).toThrowError(/slot\.b, tile\.Show/);

    expect(snapshot(file)).toEqual(before);
  });

  it("refuses a cascade that does not say what it removed", () => {
    const { file, removeId } = cascadeFixture();
    rewriteLogEntry(file, removeId, (e) => {
      delete e.removed;
      delete e.bodies;
    });
    const before = snapshot(file);

    expect(() => patchRevert(file, removeId)).toThrowError(/does not record what it removed/);

    expect(snapshot(file)).toEqual(before);
  });
});

describe("patch apply of cascade ops", () => {
  it("replays the restore op on the state it was made from", () => {
    const { file, removeId } = cascadeFixture();
    const afterCascade = snapshot(file);
    const restoreId = patchRevert(file, removeId);
    const restore = readOpLog(file).find((e) => e["op-id"] === restoreId)!;
    // Put the file back as it was after the cascade, without reverting anything.
    writeFileSync(file, afterCascade.source);
    writeFileSync(logPath(file), afterCascade.log);
    const bundle = join(dir, "ops.jsonl");
    writeFileSync(bundle, `${JSON.stringify(restore)}\n`);

    patchApplyFile(file, bundle);

    expect(qnames(file)).toEqual(["slot.a", "slot.b", "tile.Page", "tile.Show"]);
  });

  it("replays a removal of the recorded set as that set, not as a fresh cascade", () => {
    const { file, restoreId } = restoredFixture();
    replaceDef(file, "tile.Show", 'text("x")');
    const beforeRevert = snapshot(file);
    const revertId = patchRevert(file, restoreId);
    const removal = readOpLog(file).find((e) => e["op-id"] === revertId)!;
    writeFileSync(file, beforeRevert.source);
    writeFileSync(logPath(file), beforeRevert.log);
    const bundle = join(dir, "ops.jsonl");
    writeFileSync(bundle, `${JSON.stringify(removal)}\n`);

    patchApplyFile(file, bundle);

    expect(qnames(file)).toEqual(["slot.a"]);
  });

  it("rejects an `add` whose `with` member has no name, writing nothing", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "b", "Int = 1");
    const before = snapshot(file);
    const bundle = join(dir, "ops.jsonl");
    const op = {
      op: "add",
      layer: "slot",
      name: "c",
      body: "Int = 2",
      with: [{ layer: "slot", body: "Int = 3" }],
    };
    writeFileSync(bundle, `${JSON.stringify(op)}\n`);

    expect(() => patchApplyFile(file, bundle)).toThrowError(/`with`\[0\]\.name must be a string/);

    expect(snapshot(file)).toEqual(before);
  });

  it("rejects `with` on an op other than `add`", () => {
    const file = seed("slot a : Int = 0\n");
    addDef(file, "slot", "b", "Int = 1");
    const before = snapshot(file);
    const bundle = join(dir, "ops.jsonl");
    const op = {
      op: "replace",
      layer: "slot",
      name: "b",
      body: "Int = 2",
      with: [{ layer: "slot", name: "c", body: "Int = 3" }],
    };
    writeFileSync(bundle, `${JSON.stringify(op)}\n`);

    expect(() => patchApplyFile(file, bundle)).toThrowError(/`with` is only valid on `add`/);

    expect(snapshot(file)).toEqual(before);
  });

  it("reports a malformed `with` in the op log by its line", () => {
    const { file, restoreId } = restoredFixture();
    rewriteLogEntry(file, restoreId, (e) => {
      e.with = "tile.Show";
    });

    expect(() => readOpLog(file)).toThrowError(/kumiki-ops\.jsonl:\d+: `with` must be an array/);
  });
});
