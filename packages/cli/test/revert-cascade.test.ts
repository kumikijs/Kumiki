// `patch revert` of a `remove --cascade` undoes the whole op: every definition
// the cascade took comes back, in one op, or nothing is written.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDef,
  listDefs,
  load,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  replaceDef,
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

const qnames = (file: string): string[] =>
  listDefs(load(file))
    .map((d) => `${d.layer}.${d.name}`)
    .sort();

/** `slot.b` with two tiles hanging off it, every body in the op log. */
const cascadeFixture = (): { file: string; removeId: string } => {
  const file = seed("slot a : Int = 0\n");
  addDef(file, "slot", "b", "Int = 1");
  addDef(file, "tile", "Show", "text(b.show)");
  addDef(file, "tile", "Page", "column(Show)");
  const { opId } = removeDef(file, "slot.b", true);
  return { file, removeId: opId };
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

  it("writes nothing and names what it cannot restore when a body is missing", () => {
    // `tile.Show` predates the op log, so no op holds its body.
    const file = seed("slot a : Int = 0\nslot b : Int = 1\ntile Show = text(b.show)\n");
    addDef(file, "tile", "Page", "column(Show)");
    const { opId } = removeDef(file, "slot.b", true);
    const source = readFileSync(file, "utf8");
    const logLength = readOpLog(file).length;

    expect(() => patchRevert(file, opId)).toThrowError(/slot\.b, tile\.Show/);

    expect(readFileSync(file, "utf8")).toBe(source);
    expect(readOpLog(file)).toHaveLength(logLength);
  });

  it("restores the body a definition had when it was removed, not its first one", () => {
    const { file } = (() => {
      const f = seed("slot a : Int = 0\n");
      addDef(f, "slot", "b", "Int = 1");
      addDef(f, "tile", "Show", "text(b.show)");
      replaceDef(f, "tile.Show", 'text("b = " + b.show)');
      return { file: f };
    })();
    const { opId } = removeDef(file, "slot.b", true);

    patchRevert(file, opId);

    expect(readFileSync(file, "utf8")).toContain('tile Show = text("b = " + b.show)');
  });

  it("reverting the restore removes the same set again", () => {
    const { file, removeId } = cascadeFixture();
    const restoreId = patchRevert(file, removeId);
    expect(qnames(file)).toHaveLength(4);

    patchRevert(file, restoreId);

    expect(qnames(file)).toEqual(["slot.a"]);
  });

  it("replays the restore op through patch apply", () => {
    const { file, removeId } = cascadeFixture();
    const restoreId = patchRevert(file, removeId);
    const restore = readOpLog(file).find((e) => e["op-id"] === restoreId)!;
    // Take the file back to the post-cascade state, then replay the op.
    patchRevert(file, restoreId);
    const bundle = join(dir, "ops.jsonl");
    writeFileSync(bundle, `${JSON.stringify(restore)}\n`);

    patchApplyFile(file, bundle);

    expect(qnames(file)).toEqual(["slot.a", "slot.b", "tile.Page", "tile.Show"]);
  });
});
