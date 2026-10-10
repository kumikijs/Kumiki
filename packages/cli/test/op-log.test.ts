import * as fs from "node:fs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addDef,
  editDef,
  load,
  patchApplyFile,
  patchRevert,
  readOpLog,
  replaceDef,
  viewDef,
  viewHash,
  viewHistory,
} from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "./helpers/defined.ts";
import { seedCopy } from "./helpers/files.ts";
import { asAgent, logPath } from "./helpers/op-log.ts";

const TODOMVC = app("02-todomvc");

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

afterEach(() => {
  vi.restoreAllMocks();
});

let path: string;
beforeEach(() => {
  path = seedCopy(TODOMVC);
});

const ULID_OP_ID = /^op_[0-9A-HJ-NP-TV-Z]{26}$/;

describe("op log wire format", () => {
  it("emits kebab-case op-id, parent-ops, depends-on, author, ts", () => {
    const id = addDef(path, "slot", "lastFilter", "Filter = All");
    const log = readOpLog(path);
    expect(log).toHaveLength(1);
    const entry = defined(log[0], "the add op");
    expect(entry["op-id"]).toBe(id);
    expect(entry["parent-ops"]).toEqual([]);
    expect(entry["depends-on"].some((d) => d.startsWith("type:Filter@h:"))).toBe(true);
    expect(typeof entry.author).toBe("string");
    expect(typeof entry.ts).toBe("number");
  });

  it("chains parent-ops to the last op-id, with ULID-shaped ids that sort by time", () => {
    const first = addDef(path, "slot", "lastSync", "Option(Time) = None");
    const second = addDef(path, "slot", "prevSync", "Option(Time) = None");
    expect(readOpLog(path).map((e) => [e["op-id"], e["parent-ops"]])).toEqual([
      [first, []],
      [second, [first]],
    ]);
    expect(first).toMatch(ULID_OP_ID);
    expect(second).toMatch(ULID_OP_ID);
    expect(second.slice(3, 13) >= first.slice(3, 13)).toBe(true);
  });

  it.each([
    ["an op log it appended to", true],
    ["no op log, as before its first op", false],
  ])("an append that fails partway leaves %s as it was", (_, logged) => {
    if (logged) addDef(path, "slot", "lastSync", "Option(Time) = None");
    const source = readFileSync(path, "utf8");
    const log = existsSync(logPath(path)) ? readFileSync(logPath(path), "utf8") : null;
    const realAppend = fs.appendFileSync;
    vi.spyOn(fs, "appendFileSync").mockImplementationOnce((file, data) => {
      realAppend(file, String(data).slice(0, 10));
      throw new Error("ENOSPC: simulated");
    });
    expect(() => addDef(path, "slot", "prevSync", "Option(Time) = None")).toThrow(/ENOSPC/);
    expect(readFileSync(path, "utf8")).toBe(source);
    expect(existsSync(logPath(path)) ? readFileSync(logPath(path), "utf8") : null).toBe(log);
  });

  it("honors KUMIKI_AUTHOR for the author field", () => {
    asAgent("agent:claude-7");
    addDef(path, "slot", "lastSync", "Option(Time) = None");
    expect(readOpLog(path)[0]?.author).toBe("agent:claude-7");
  });
});

describe("patch apply / revert", () => {
  const writeOps = (ops: object[]): string => {
    const opsFile = join(dirname(path), "ops.jsonl");
    writeFileSync(opsFile, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    return opsFile;
  };

  it("applies a JSONL ops bundle in order", () => {
    const ids = patchApplyFile(
      path,
      writeOps([
        { op: "add", layer: "slot", name: "lastSync", body: "Option(Time) = None" },
        { op: "replace", layer: "slot", name: "lastSync", body: "Option(Time) = Some(now)" },
      ]),
    );
    expect(ids).toHaveLength(2);
    expect(viewDef(load(path), "slot.lastSync")).toContain("= Some(now)");
  });

  it("rolls back the file, and drops the op log it started without, when any op fails", () => {
    const before = readFileSync(path, "utf8");
    const opsFile = writeOps([
      { op: "add", layer: "slot", name: "lastSync", body: "Option(Time) = None" },
      { op: "add", layer: "tile", name: "Broken", body: "column(Nonexistent)" },
    ]);
    expect(() => patchApplyFile(path, opsFile)).toThrowError(/patch apply rejected/);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(logPath(path))).toBe(false);
  });

  it("reverts an add op", () => {
    const id = addDef(path, "slot", "lastSync", "Option(Time) = None");
    patchRevert(path, id);
    expect(load(path).byQName.has("slot.lastSync")).toBe(false);
  });

  it("reverts a replace op by restoring the prior body", () => {
    addDef(path, "slot", "counter", "Int = 0");
    patchRevert(path, replaceDef(path, "slot.counter", "Int = 9").opId);
    expect(viewDef(load(path), "slot.counter")).toContain("= 0");
  });

  it("reverts edit2 in an add → edit1 → edit2 chain to the edit1 state", () => {
    addDef(path, "slot", "counter", "Int = 0");
    editDef(path, "slot.counter", { find: "= 0", replace: "= 1" });
    patchRevert(path, editDef(path, "slot.counter", { find: "= 1", replace: "= 2" }));
    expect(viewDef(load(path), "slot.counter")).toContain("= 1");
  });
});

describe("viewHistory / viewHash", () => {
  it("returns ops for one qname in chronological order", () => {
    addDef(path, "slot", "lastSync", "Option(Time) = None");
    replaceDef(path, "slot.lastSync", "Option(Time) = Some(now)");
    replaceDef(path, "slot.lastSync", "Option(Time) = None");
    addDef(path, "slot", "other", "Option(Time) = None");
    expect(viewHistory(path, "slot.lastSync").map((e) => e.op)).toEqual([
      "add",
      "replace",
      "replace",
    ]);
  });

  it("produces a stable hash for the same body and a different hash when deps change", () => {
    addDef(path, "type", "Counter", "Int");
    addDef(path, "slot", "n", "Counter = 0");
    const h1 = viewHash(load(path), "slot.n");
    replaceDef(path, "type.Counter", "Int where between(0, 99)");
    const h2 = viewHash(load(path), "slot.n");
    expect(h1).not.toBe(h2);
    expect(viewHash(load(path), "slot.n")).toBe(h2);
  });

  it("aligns the depends-on hash with view --hash of the same dep", () => {
    const id = addDef(path, "slot", "lastFilter", "Filter = All");
    const entry = readOpLog(path).find((e) => e["op-id"] === id);
    const filterDep = defined(
      entry?.["depends-on"].find((d) => d.startsWith("type:Filter@h:")),
      "a depends-on entry for type.Filter",
    );
    expect(viewHash(load(path), "type.Filter")).toBe(filterDep.split("@h:")[1]);
  });
});
