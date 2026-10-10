import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { threadId } from "node:worker_threads";
import {
  addDef,
  describeEdit,
  type EditReport,
  editDef,
  findReferences,
  listDefs,
  load,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  viewDef,
} from "@kumikijs/cli";
import { check } from "@kumikijs/compiler";
import { app } from "@kumikijs/examples";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDefs, removeSet } from "../src/mutate/verbs.ts";
import { writeLockPath } from "../src/write-lock.ts";
import { seedCopy } from "./helpers/files.ts";

const COUNTER = app("01-counter");
const TODOMVC = app("02-todomvc");

describe("kumiki mutate: add / replace / rename / remove", () => {
  let path: string;
  beforeEach(() => {
    path = seedCopy(TODOMVC);
  });

  it("adds a new slot at the end of the file, validates and logs it", () => {
    addDef(path, "slot", "lastSync", "Option(Time) = None");
    const store = load(path);
    expect(viewDef(store, "slot.lastSync")).toContain("slot lastSync : Option(Time) = None");
    expect(readOpLog(path)).toMatchObject([{ op: "add", name: "lastSync" }]);
  });

  it.each([
    ["introduces a typecheck error", "tile", "Broken", "column(Nonexistent)", /Validation failed/],
    ["would duplicate an existing definition", "slot", "draft", 'Text = ""', /E0007/],
  ] as const)("rolls back an add that %s", (_, layer, name, body, message) => {
    const before = readFileSync(path, "utf8");
    expect(() => addDef(path, layer, name, body)).toThrowError(message);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses a rename onto an existing name in the same layer", () => {
    const before = readFileSync(path, "utf8");
    expect(() => renameDef(path, "slot.draft", "todos")).toThrowError(/already exists/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("allows a rename onto a name taken in a different layer", () => {
    renameDef(path, "slot.draft", "matchFilter");
    const store = load(path);
    expect(store.byQName.has("slot.matchFilter")).toBe(true);
    expect(store.byQName.has("fn.matchFilter")).toBe(true);
  });

  it("rename updates the def and every reference", () => {
    renameDef(path, "slot.draft", "newTodoText");
    const store = load(path);
    expect(store.byQName.has("slot.draft")).toBe(false);
    expect(findReferences(store, "slot.newTodoText").length).toBeGreaterThan(0);
  });

  it("remove without --cascade fails on referenced slot", () => {
    expect(() => removeDef(path, "slot.todos", false)).toThrowError(/Cannot remove .* references/);
  });

  it("remove --cascade is rejected and the file restored when validation fails", () => {
    expect(() => removeDef(path, "slot.filter", true)).toThrowError(/remove rejected/);
    expect(load(path).byQName.has("slot.filter")).toBe(true);
  });

  it("replace swaps the body and validates", () => {
    replaceDef(path, "slot.draft", 'Text = ""');
    const body = viewDef(load(path), "slot.draft");
    expect(body).toContain('Text = ""');
    expect(body).not.toContain("where len-lt");
  });

  it("refuses a file that does not exist, naming it and writing nothing beside it", () => {
    const dir = dirname(path);
    const ops = join(dir, "ops.jsonl");
    writeFileSync(
      ops,
      `${JSON.stringify({ op: "add", layer: "slot", name: "x", body: "N = 1" })}\n`,
    );
    const missing = join(dir, "missing.kumiki");
    const writes: Array<() => unknown> = [
      () => addDef(missing, "slot", "x", "N = 1"),
      () => replaceDef(missing, "slot.draft", 'Text = ""'),
      () => removeDef(missing, "slot.draft", false),
      () => renameDef(missing, "slot.draft", "text"),
      () => editDef(missing, "slot.draft", { find: '""', replace: '"x"' }),
      () => patchApplyFile(missing, ops),
      () => patchRevert(missing, "op_0000000000AAAAAAAAAAAAAAAA"),
    ];
    const before = readdirSync(dir).sort();
    for (const write of writes) {
      expect(write).toThrowError(`File "${missing}" not found`);
      expect(readdirSync(dir).sort()).toEqual(before);
    }
  });
});

describe("editDef: partial edits", () => {
  let path: string;
  beforeEach(() => {
    path = seedCopy(TODOMVC);
    addDef(path, "slot", "counter", "Int = 0");
  });

  it("applies a find/replace patch and logs an edit op", () => {
    const id = editDef(path, "slot.counter", { find: "= 0", replace: "= 5" });
    expect(viewDef(load(path), "slot.counter")).toContain("= 5");
    expect(readOpLog(path).find((e) => e["op-id"] === id)).toMatchObject({
      op: "edit",
      layer: "slot",
      name: "counter",
    });
  });

  it("applies per-line body patches", () => {
    editDef(path, "slot.counter", { "body:1": "replace '0' -> '7'" });
    expect(viewDef(load(path), "slot.counter")).toContain("= 7");
  });

  it.each([
    ["whose find pattern is absent", { find: "ZZZ", replace: "AAA" }, /not present/],
    ["that is empty", {}, /edit rejected/],
    ["that breaks validation", { find: "Int = 0", replace: "Int = ???" }, /edit rejected/],
  ])("rejects an edit %s and leaves the file alone", (_, patch, message) => {
    const before = readFileSync(path, "utf8");
    expect(() => editDef(path, "slot.counter", patch)).toThrowError(message);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("treats $-sequences in the replacement as literal text", () => {
    addDef(path, "slot", "label", 'Text = "hi"');
    editDef(path, "slot.label", { find: '"hi"', replace: '"$& $$ $`"' });
    expect(viewDef(load(path), "slot.label")).toContain('"$& $$ $`"');
  });

  it("records the post-edit body so depends-on is populated for edit ops", () => {
    addDef(path, "slot", "lastFilter", "Filter = All");
    const id = editDef(path, "slot.lastFilter", { find: "= All", replace: "= Active" });
    const entry = readOpLog(path).find((e) => e["op-id"] === id);
    expect(entry?.body).toContain("= Active");
    expect(entry?.["depends-on"].some((d) => d.startsWith("type:Filter@h:"))).toBe(true);
  });
});

describe("describeEdit: the report an edit gives of itself", () => {
  it("puts the requested definition on the headline and the rest under it", () => {
    const out = describeEdit({
      op: "remove",
      qname: "slot.count",
      opId: "op_0001",
      removed: ["slot.count", "app.Counter", "tile.App"],
    });
    expect(out.split("\n")).toEqual([
      "removed slot.count  (op_0001)",
      "  cascaded app.Counter",
      "  cascaded tile.App",
    ]);
  });

  it.each([
    [
      { op: "remove", qname: "app.Counter", opId: "op_0", removed: ["app.Counter"] },
      "removed app.Counter  (op_0)",
    ],
    [{ op: "add", qname: "slot.step", opId: "op_1" }, "added slot.step  (op_1)"],
    [{ op: "replace", qname: "slot.step", opId: "op_2" }, "replaced slot.step  (op_2)"],
    [{ op: "edit", qname: "reducer.inc", opId: "op_3" }, "edited reducer.inc  (op_3)"],
    [
      { op: "rename", qname: "slot.step", newName: "stride", opId: "op_4" },
      "renamed slot.step -> stride  (op_4)",
    ],
  ] satisfies [EditReport, string][])("reports %o on one line", (report, line) => {
    expect(describeEdit(report)).toBe(line);
  });

  it("reports a real cascade off what removeDef returned", () => {
    const result = removeDef(seedCopy(COUNTER), "slot.count", true);
    const out = describeEdit({ op: "remove", qname: "slot.count", ...result });
    expect(out.split("\n").slice(1)).toEqual([
      "  cascaded app.Counter",
      "  cascaded reducer.dec",
      "  cascaded reducer.inc",
      "  cascaded reducer.reset",
      "  cascaded tile.App",
    ]);
  });
});

describe("parallel op merge", () => {
  it("converges regardless of op order: add slot + rename existing slot", () => {
    const aFirst = seedCopy(TODOMVC);
    const bFirst = seedCopy(TODOMVC);
    addDef(aFirst, "slot", "lastSync", "Option(Time) = None");
    renameDef(aFirst, "slot.draft", "newDraft");
    renameDef(bFirst, "slot.draft", "newDraft");
    addDef(bFirst, "slot", "lastSync", "Option(Time) = None");

    const names = (path: string) =>
      new Set(listDefs(load(path)).map((e) => `${e.layer}.${e.name}`));
    expect(names(aFirst)).toEqual(names(bFirst));
    expect(names(aFirst)).toContain("slot.newDraft");
    expect(names(aFirst)).toContain("slot.lastSync");
    expect(check(load(aFirst).program)).toEqual([]);
    expect(check(load(bFirst).program)).toEqual([]);
  });
});

describe("the write verbs history replays, called outside any write lock", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["addDefs", (path: string) => addDefs(path, [{ layer: "slot", name: "extra", body: "N = 0" }])],
    ["removeSet", (path: string) => removeSet(path, ["tile.ResetBtn"], false)],
  ] as const)("%s takes the write lock itself, so it waits on a writer holding it", (_, verb) => {
    vi.stubEnv("KUMIKI_WRITE_LOCK_WAIT_MS", "200");
    const path = seedCopy(COUNTER);
    const before = readFileSync(path, "utf8");
    const holder = JSON.stringify({ pid: process.pid, host: hostname(), threadId: threadId + 1 });
    writeFileSync(writeLockPath(path), holder);
    expect(() => verb(path)).toThrow(`is being written by kumiki process ${process.pid}`);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
