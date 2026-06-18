import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDef,
  editDef,
  findReferences,
  fixCmd,
  listDefs,
  load,
  lockDef,
  type OpLogEntry,
  patchApplyFile,
  patchRevert,
  planFixes,
  planTestPatch,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  unlockDef,
  viewDef,
  viewHash,
  viewHistory,
} from "@kumikijs/cli";
import { check } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const _COUNTER = resolve(here, "../../examples/apps/01-counter/app.kumiki");
const TODOMVC = resolve(here, "../../examples/apps/02-todomvc/app.kumiki");

function copy(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiki-ai-"));
  const dst = join(dir, "input.kumiki");
  copyFileSync(src, dst);
  return dst;
}

describe("kumiki store: list / view / refs", () => {
  it("lists every definition from todomvc", () => {
    const store = load(TODOMVC);
    const layers = new Set(listDefs(store).map((e) => e.layer));
    expect(layers).toContain("type");
    expect(layers).toContain("slot");
    expect(layers).toContain("effect");
    expect(layers).toContain("reducer");
    expect(layers).toContain("fn");
    expect(layers).toContain("tile");
    expect(layers).toContain("app");
    expect(layers).toContain("theme");
  });

  it("views a specific slot", () => {
    const store = load(TODOMVC);
    const text = viewDef(store, "slot.todos");
    expect(text).toContain("slot todos");
    expect(text).toContain("Map(TodoId, Todo)");
  });

  it("finds references to slot.todos", () => {
    const store = load(TODOMVC);
    const refs = findReferences(store, "slot.todos");
    const names = new Set(refs.map((r) => r.qname));
    expect(names.has("reducer.addTodo")).toBe(true);
    expect(names.has("reducer.toggle")).toBe(true);
    expect(names.has("reducer.remove")).toBe(true);
    expect(names.has("reducer.clearDone")).toBe(true);
  });
});

describe("kumiki mutate: add / replace / rename / remove", () => {
  let path: string;
  beforeEach(() => {
    path = copy(TODOMVC);
  });
  afterEach(() => {
    rmSync(dirname(path), { recursive: true, force: true });
  });

  it("adds a new slot at the end of the file and validates", () => {
    addDef(path, "slot", "lastSync", "Time = 0");
    const store = load(path);
    expect(store.byQName.has("slot.lastSync")).toBe(true);
    expect(viewDef(store, "slot.lastSync")).toContain("slot lastSync : Time = 0");
    // op log entry
    const log = readFileSync(`${path}.kumiki-ops.jsonl`, "utf8");
    expect(log).toContain('"op":"add"');
    expect(log).toContain('"name":"lastSync"');
  });

  it("rolls back when add introduces a typecheck error", () => {
    const before = readFileSync(path, "utf8");
    expect(() => addDef(path, "tile", "Broken", "column(Nonexistent)")).toThrowError(
      /Validation failed/,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("rename updates the def and every reference", () => {
    renameDef(path, "slot.draft", "newTodoText");
    const store = load(path);
    expect(store.byQName.has("slot.newTodoText")).toBe(true);
    expect(store.byQName.has("slot.draft")).toBe(false);
    const refs = findReferences(store, "slot.newTodoText");
    expect(refs.length).toBeGreaterThan(0);
  });

  it("remove without --cascade fails on referenced slot", () => {
    expect(() => removeDef(path, "slot.todos", false)).toThrowError(/Cannot remove .* references/);
  });

  it("remove --cascade gets rejected when validation fails (densely-coupled file)", () => {
    // TodoMVC is so tightly coupled around `slot.filter` that cascading it
    // pulls in shared infrastructure (matchFilter, FilterTab, FilterBar,
    // Footer, App, …) and the residual file no longer typechecks. The
    // PoC's "validate-then-rollback" behaviour kicks in and reports.
    expect(() => removeDef(path, "slot.filter", true)).toThrowError(/remove rejected/);
    // Original file is restored.
    const store = load(path);
    expect(store.byQName.has("slot.filter")).toBe(true);
  });

  it("replace swaps the body and validates", () => {
    replaceDef(path, "slot.draft", 'Text = ""');
    const store = load(path);
    const body = viewDef(store, "slot.draft");
    expect(body).toContain('Text = ""');
    expect(body).not.toContain("where len-lt");
  });
});

describe("kumiki fix: auto-patch suggestions", () => {
  it("suggests did-you-mean for an undef slot reference", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `type N = nominal Int where between(0, 999)
slot count : N = 0
reducer inc on=ui.click(IncBtn) do= conut := conut + 1
tile IncBtn = button(text="+")
tile App = column(heading("Count: " + count), IncBtn)
app Counter
    caps = []
    routes = {"/" -> App}
    init = []
`,
    );
    const store = load(file);
    const errors = check(store.program);
    const patches = planFixes(store, errors);
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "conut" with "count"`))).toBe(true);
    expect(descs.some((d) => d.includes(`"/404" -> NotFound`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("apply fixes the file end-to-end", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `type N = nominal Int where between(0, 999)
slot count : N = 0
reducer inc on=ui.click(IncBtn) do= conut := conut + 1
tile IncBtn = button(text="+")
tile App = column(heading("Count: " + count), IncBtn)
app Counter
    caps = []
    routes = {"/" -> App}
    init = []
`,
    );
    fixCmd(file, true);
    const store = load(file);
    expect(check(store.program)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

// M4b: `planTestPatch` is the deterministic core of `kumiki fix --auto-patch`.
// It is a pure function (no DOM / no test execution), so it is unit-tested here;
// the end-to-end fix-from-test loop is covered by subprocess tests in cli.test.ts.
describe("planTestPatch: deterministic literal repair from a failing test", () => {
  it("proposes replacing a unique source literal with the expected text", () => {
    const source = `tile Title = heading("Helo")\n`;
    const patch = planTestPatch(source, {
      name: "title-text",
      pass: false,
      diffAt: "heading.text",
      leaf: { expected: "Hello", actual: "Helo" },
    });
    expect(patch).not.toBeNull();
    expect(patch?.description).toContain('replace "Helo" with "Hello"');
    expect(patch?.apply(source)).toBe(`tile Title = heading("Hello")\n`);
  });

  it("returns null when the actual text is not a verbatim source literal", () => {
    // The rendered text was assembled by concatenation, so "Count: 5" never
    // appears as a literal — nothing deterministic to patch.
    const source = `tile App = heading("Count: " + count.show)\n`;
    const patch = planTestPatch(source, {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { expected: "Count: 5", actual: "Count: 0" },
    });
    expect(patch).toBeNull();
  });

  it("returns null when the literal occurs more than once (ambiguous target)", () => {
    const source = `tile A = heading("Helo")\ntile B = label("Helo")\n`;
    const patch = planTestPatch(source, {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { expected: "Hello", actual: "Helo" },
    });
    expect(patch).toBeNull();
  });

  it("returns null for a non-string leaf (numeric mismatch is not literal-repairable)", () => {
    const source = `reducer dec on=ui.click(B) do= count := count - 1\n`;
    const patch = planTestPatch(source, {
      name: "t",
      pass: false,
      diffAt: "slots.count",
      leaf: { expected: 1, actual: -1 },
    });
    expect(patch).toBeNull();
  });

  it("does not mis-handle a `$` in the expected replacement text", () => {
    const source = `tile Price = label("USD 9")\n`;
    const patch = planTestPatch(source, {
      name: "t",
      pass: false,
      diffAt: "label.text",
      leaf: { expected: "$9", actual: "USD 9" },
    });
    expect(patch?.apply(source)).toBe(`tile Price = label("$9")\n`);
  });

  it("skips a literal that lives only in a test body (no fixture self-patch)", () => {
    // The rendered text comes from the test's own `given` slot data, so "Helo"
    // appears only inside the `test` body — patching it would mutate the fixture
    // into passing without touching any production definition.
    const source = [
      "tile Msg = heading(msg.show)",
      "test t =",
      "    tile-test Msg",
      '        given  = {slots: {msg: "Helo"}}',
      '        expect = heading("Hello")',
      "",
    ].join("\n");
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { expected: "Hello", actual: "Helo" },
      },
      [[2, 5]], // the `test t` body spans lines 2-5
    );
    expect(patch).toBeNull();
  });

  it("still patches a production literal when a test body also exists", () => {
    const source = [
      'tile Title = heading("Helo")',
      "test t =",
      "    tile-test Title",
      "        given  = {slots: {}}",
      '        expect = heading("Hello")',
      "",
    ].join("\n");
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { expected: "Hello", actual: "Helo" },
      },
      [[2, 5]],
    );
    expect(patch).not.toBeNull();
    expect(patch?.apply(source)).toContain('tile Title = heading("Hello")');
  });

  it("returns null when the expected text needs an escape Kumiki cannot represent", () => {
    // Backspace (0x08) is not in the lexer's escape set (\n \t \r \" \\), so
    // emitting it as a literal would produce an invalid .kumiki file.
    const source = `tile T = heading("a")\n`;
    const patch = planTestPatch(source, {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { expected: "a\bc", actual: "a" },
    });
    expect(patch).toBeNull();
  });
});

describe("op log: spec §9.3.2 wire format", () => {
  let path: string;
  beforeEach(() => {
    path = copy(TODOMVC);
  });
  afterEach(() => {
    rmSync(dirname(path), { recursive: true, force: true });
  });

  it("emits kebab-case op-id, parent-ops, depends-on, author, ts", () => {
    // Reference Filter — a locally-defined type — so depends-on can pick it up.
    const id = addDef(path, "slot", "lastFilter", "Filter = All");
    const log = readOpLog(path);
    expect(log).toHaveLength(1);
    const entry = log[0]!;
    expect(entry["op-id"]).toBe(id);
    expect(entry["parent-ops"]).toEqual([]);
    expect(Array.isArray(entry["depends-on"])).toBe(true);
    expect(entry["depends-on"].some((d) => d.startsWith("type:Filter@h:"))).toBe(true);
    expect(typeof entry.author).toBe("string");
    expect(typeof entry.ts).toBe("number");
  });

  it("chains parent-ops to the last op-id", () => {
    const first = addDef(path, "slot", "lastSync", "Time = 0");
    const second = addDef(path, "slot", "prevSync", "Time = 0");
    const log = readOpLog(path);
    expect(log).toHaveLength(2);
    expect(log[0]!["op-id"]).toBe(first);
    expect(log[1]!["op-id"]).toBe(second);
    expect(log[1]!["parent-ops"]).toEqual([first]);
  });

  it("emits ULID-shaped op-ids that sort by time", () => {
    // §9.3.3 decides same-name add winners by op-id lexicographic order, so
    // op-ids must be monotonic with creation time — that's why the id is a
    // ULID (10-char ms timestamp + 16 random chars) rather than fully random.
    const first = addDef(path, "slot", "lastSync", "Time = 0");
    const second = addDef(path, "slot", "prevSync", "Time = 0");
    expect(first).toMatch(/^op_[0-9A-HJ-NP-TV-Z]{26}$/);
    expect(second).toMatch(/^op_[0-9A-HJ-NP-TV-Z]{26}$/);
    // Time-prefix (chars 3..13) must be non-decreasing across calls.
    expect(second.slice(3, 13) >= first.slice(3, 13)).toBe(true);
  });

  it("honors KUMIKI_AUTHOR for the author field", () => {
    const prev = process.env.KUMIKI_AUTHOR;
    process.env.KUMIKI_AUTHOR = "agent:claude-7";
    try {
      addDef(path, "slot", "lastSync", "Time = 0");
      const log = readOpLog(path);
      expect(log[0]!.author).toBe("agent:claude-7");
    } finally {
      if (prev === undefined) delete process.env.KUMIKI_AUTHOR;
      else process.env.KUMIKI_AUTHOR = prev;
    }
  });
});

describe("editDef: partial edits", () => {
  let path: string;
  beforeEach(() => {
    path = copy(TODOMVC);
  });
  afterEach(() => {
    rmSync(dirname(path), { recursive: true, force: true });
  });

  it("applies a find/replace patch and logs an edit op", () => {
    addDef(path, "slot", "counter", "Int = 0");
    const id = editDef(path, "slot.counter", { find: "= 0", replace: "= 5" });
    expect(id.startsWith("op_")).toBe(true);
    const store = load(path);
    const body = viewDef(store, "slot.counter");
    expect(body).toContain("= 5");
    const log = readOpLog(path);
    const editEntry = log.find((e: OpLogEntry) => e.op === "edit");
    expect(editEntry).toBeDefined();
    expect(editEntry?.layer).toBe("slot");
    expect(editEntry?.name).toBe("counter");
  });

  it("rejects an edit whose find pattern is absent", () => {
    addDef(path, "slot", "counter", "Int = 0");
    expect(() => editDef(path, "slot.counter", { find: "ZZZ", replace: "AAA" })).toThrowError(
      /not present/,
    );
  });

  it("rejects an empty patch", () => {
    addDef(path, "slot", "counter", "Int = 0");
    expect(() => editDef(path, "slot.counter", {})).toThrowError(/edit rejected/);
  });

  it("treats $-sequences in the replacement as literal text", () => {
    // String.prototype.replace would interpret `$&` as the match; a function
    // replacer must short-circuit that. Use a Text slot so quotes parse.
    addDef(path, "slot", "label", 'Text = "hi"');
    editDef(path, "slot.label", { find: '"hi"', replace: '"$& $$ $`"' });
    const next = load(path);
    expect(viewDef(next, "slot.label")).toContain('"$& $$ $`"');
  });

  it("records the post-edit body so depends-on is populated for edit ops", () => {
    addDef(path, "slot", "lastFilter", "Filter = All");
    const id = editDef(path, "slot.lastFilter", { find: "= All", replace: "= Active" });
    const log = readOpLog(path);
    const entry = log.find((e) => e["op-id"] === id);
    expect(entry).toBeDefined();
    expect(typeof entry?.body).toBe("string");
    expect(entry?.body).toContain("= Active");
    expect(entry?.["depends-on"].some((d) => d.startsWith("type:Filter@h:"))).toBe(true);
  });

  it("rolls back an edit that breaks validation", () => {
    addDef(path, "slot", "counter", "Int = 0");
    const before = readFileSync(path, "utf8");
    // Inject a clearly malformed token sequence so the parser/typechecker rejects.
    expect(() =>
      editDef(path, "slot.counter", { find: "Int = 0", replace: "Int = ???" }),
    ).toThrowError(/edit rejected/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("applies per-line body patches in spec auto-patch format", () => {
    addDef(path, "slot", "counter", "Int = 0");
    // body:1 is the first line of the definition body — the §9.6.1 auto-patch
    // keys are relative to the definition, not the whole file.
    const id = editDef(path, "slot.counter", {
      "body:1": "replace '0' -> '7'",
    });
    expect(id.startsWith("op_")).toBe(true);
    const next = load(path);
    expect(viewDef(next, "slot.counter")).toContain("= 7");
  });
});

describe("patch apply / revert", () => {
  let path: string;
  beforeEach(() => {
    path = copy(TODOMVC);
  });
  afterEach(() => {
    rmSync(dirname(path), { recursive: true, force: true });
  });

  it("applies a JSONL ops bundle in order", () => {
    const opsFile = join(dirname(path), "ops.jsonl");
    const ops = [
      { op: "add", layer: "slot", name: "lastSync", body: "Time = 0" },
      { op: "replace", layer: "slot", name: "lastSync", body: "Time = 100" },
    ];
    writeFileSync(opsFile, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    const ids = patchApplyFile(path, opsFile);
    expect(ids).toHaveLength(2);
    const store = load(path);
    expect(viewDef(store, "slot.lastSync")).toContain("= 100");
  });

  it("rolls back the file when any op in the bundle fails", () => {
    const before = readFileSync(path, "utf8");
    const opsFile = join(dirname(path), "ops.jsonl");
    const ops = [
      { op: "add", layer: "slot", name: "lastSync", body: "Time = 0" },
      { op: "add", layer: "tile", name: "Broken", body: "column(Nonexistent)" },
    ];
    writeFileSync(opsFile, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    expect(() => patchApplyFile(path, opsFile)).toThrowError(/patch apply rejected/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("removes the op log entirely when the bundle started without one", async () => {
    // If the partial apply created the op log file, a rollback should delete
    // it rather than leave an empty file behind that future ops would chain
    // off of (with no parent-ops).
    const { existsSync: exists } = await import("node:fs");
    const opsFile = join(dirname(path), "ops.jsonl");
    const ops = [
      { op: "add", layer: "slot", name: "lastSync", body: "Time = 0" },
      { op: "add", layer: "tile", name: "Broken", body: "column(Nonexistent)" },
    ];
    writeFileSync(opsFile, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    expect(() => patchApplyFile(path, opsFile)).toThrow();
    expect(exists(`${path}.kumiki-ops.jsonl`)).toBe(false);
  });

  it("reverts an add op via patchRevert", () => {
    const id = addDef(path, "slot", "lastSync", "Time = 0");
    expect(load(path).byQName.has("slot.lastSync")).toBe(true);
    patchRevert(path, id);
    expect(load(path).byQName.has("slot.lastSync")).toBe(false);
  });

  it("reverts a replace op by restoring the prior body", () => {
    addDef(path, "slot", "counter", "Int = 0");
    const replaceId = replaceDef(path, "slot.counter", "Int = 9");
    patchRevert(path, replaceId);
    const store = load(path);
    expect(viewDef(store, "slot.counter")).toContain("= 0");
  });

  it("reverts edit2 in an add → edit1 → edit2 chain to the edit1 state", () => {
    // Without the post-edit body on edit1, priorBody would walk back to the
    // add op and edit1's contribution would silently vanish. Recording the
    // body keeps revert faithful to the immediate predecessor.
    addDef(path, "slot", "counter", "Int = 0");
    editDef(path, "slot.counter", { find: "= 0", replace: "= 1" });
    const edit2 = editDef(path, "slot.counter", { find: "= 1", replace: "= 2" });
    patchRevert(path, edit2);
    const store = load(path);
    expect(viewDef(store, "slot.counter")).toContain("= 1");
  });
});

describe("viewHistory / viewHash", () => {
  let path: string;
  beforeEach(() => {
    path = copy(TODOMVC);
  });
  afterEach(() => {
    rmSync(dirname(path), { recursive: true, force: true });
  });

  it("returns ops for one qname in chronological order", () => {
    addDef(path, "slot", "lastSync", "Time = 0");
    replaceDef(path, "slot.lastSync", "Time = 1");
    replaceDef(path, "slot.lastSync", "Time = 2");
    addDef(path, "slot", "other", "Time = 0"); // irrelevant
    const hist = viewHistory(path, "slot.lastSync");
    expect(hist).toHaveLength(3);
    expect(hist[0]!.op).toBe("add");
    expect(hist[1]!.op).toBe("replace");
    expect(hist[2]!.op).toBe("replace");
  });

  it("produces a stable hash for the same body and a different hash when deps change", () => {
    addDef(path, "type", "Counter", "Int");
    addDef(path, "slot", "n", "Counter = 0");
    const store1 = load(path);
    const h1 = viewHash(store1, "slot.n");
    // mutate dep — hash must change
    replaceDef(path, "type.Counter", "Int where between(0, 99)");
    const store2 = load(path);
    const h2 = viewHash(store2, "slot.n");
    expect(h1).not.toBe(h2);
    // same source → same hash
    expect(viewHash(store2, "slot.n")).toBe(h2);
  });

  it("aligns the depends-on hash with view --hash of the same dep", () => {
    // depends-on records `<layer>:<name>@h:<hash>` where the hash is the same
    // §9.5.1 transitive content hash that view --hash exposes. The two must
    // line up so an agent can cross-check references.
    const id = addDef(path, "slot", "lastFilter", "Filter = All");
    const log = readOpLog(path);
    const entry = log.find((e) => e["op-id"] === id);
    const filterDep = entry?.["depends-on"].find((d) => d.startsWith("type:Filter@h:"));
    expect(filterDep).toBeDefined();
    const recordedHash = filterDep!.split("@h:")[1]!;
    const store = load(path);
    expect(viewHash(store, "type.Filter")).toBe(recordedHash);
  });
});

describe("ownership lock", () => {
  let path: string;
  beforeEach(() => {
    path = copy(TODOMVC);
    delete process.env.KUMIKI_AUTHOR;
  });
  afterEach(() => {
    rmSync(dirname(path), { recursive: true, force: true });
    delete process.env.KUMIKI_AUTHOR;
  });

  it("rejects ops from another author within a locked pattern", () => {
    process.env.KUMIKI_AUTHOR = "agent-1";
    lockDef(path, "agent-1", "slot.todos*,reducer.todo*");
    process.env.KUMIKI_AUTHOR = "agent-2";
    expect(() => addDef(path, "slot", "todosNew", "Int = 0")).toThrowError(/lock violation/);
  });

  it("permits the lock holder to keep editing", () => {
    process.env.KUMIKI_AUTHOR = "agent-1";
    lockDef(path, "agent-1", "slot.todos*");
    expect(() => addDef(path, "slot", "todosBackup", "Int = 0")).not.toThrow();
  });

  it("permits unrelated ops by other authors", () => {
    process.env.KUMIKI_AUTHOR = "agent-1";
    lockDef(path, "agent-1", "slot.todos*");
    process.env.KUMIKI_AUTHOR = "agent-2";
    expect(() => addDef(path, "slot", "lastSync", "Time = 0")).not.toThrow();
  });

  it("unlock removes the agent's claim", () => {
    process.env.KUMIKI_AUTHOR = "agent-1";
    lockDef(path, "agent-1", "slot.todos*");
    unlockDef(path, "agent-1");
    process.env.KUMIKI_AUTHOR = "agent-2";
    expect(() => addDef(path, "slot", "todosNew", "Int = 0")).not.toThrow();
  });
});

describe("parallel op merge", () => {
  // Simulate two independent agents editing in parallel. We apply their ops in
  // both orders and check that the file converges to the same logical state
  // (= same defs, no typecheck errors).
  it("converges regardless of op order: add slot + rename existing slot", () => {
    const aFirst = copy(TODOMVC);
    const bFirst = copy(TODOMVC);
    // a: add new slot. b: rename slot.draft → newDraft.
    addDef(aFirst, "slot", "lastSync", "Time = 0");
    renameDef(aFirst, "slot.draft", "newDraft");

    renameDef(bFirst, "slot.draft", "newDraft");
    addDef(bFirst, "slot", "lastSync", "Time = 0");

    const aStore = load(aFirst);
    const bStore = load(bFirst);
    const aNames = new Set(listDefs(aStore).map((e) => `${e.layer}.${e.name}`));
    const bNames = new Set(listDefs(bStore).map((e) => `${e.layer}.${e.name}`));
    expect(aNames).toEqual(bNames);
    expect(aNames.has("slot.newDraft")).toBe(true);
    expect(aNames.has("slot.lastSync")).toBe(true);
    expect(check(aStore.program)).toEqual([]);
    expect(check(bStore.program)).toEqual([]);
    rmSync(dirname(aFirst), { recursive: true, force: true });
    rmSync(dirname(bFirst), { recursive: true, force: true });
  });
});
