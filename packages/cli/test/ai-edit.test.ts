import * as fs from "node:fs";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDef,
  applyFixPlan,
  describeEdit,
  directDeps,
  editDef,
  findReferences,
  fixCmd,
  fixFromTest,
  iterStringLiterals,
  listDefs,
  load,
  lockDef,
  type OpLogEntry,
  patchApplyFile,
  patchRevert,
  planFixes,
  planFixesExplained,
  planTestPatch,
  planTestPatchExplained,
  readOpLog,
  removeDef,
  renameDef,
  replaceDef,
  runFixFromTest,
  unlockDef,
  viewDef,
  viewHash,
  viewHistory,
} from "@kumikijs/cli";
import { check, collectTimerNames, lex, parse, variantTagsOf } from "@kumikijs/compiler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Re-materialize the `node:fs` namespace as a plain object so per-test
// `vi.spyOn(fs, ...)` calls work. Native ESM module namespaces are frozen and
// reject `vi.spyOn` with "Module namespace is not configurable"; spreading
// through vi.mock yields a fresh object whose properties are configurable,
// while the default identity of every function is preserved (pass-through).
// `vi.mock` is hoisted above every import at compile time, so placing it here
// (after the imports for readability) is safe. Used by the write-failure
// tests below.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual };
});

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = resolve(here, "../../examples/apps/01-counter/app.kumiki");
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
    addDef(path, "slot", "lastSync", "Option(Time) = None");
    const store = load(path);
    expect(store.byQName.has("slot.lastSync")).toBe(true);
    expect(viewDef(store, "slot.lastSync")).toContain("slot lastSync : Option(Time) = None");
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

  // `add` refuses a duplicate through the validation gate rather than through
  // a check of its own: it writes, typechecks, and rolls back. That indirection
  // is why this is pinned — the gate is one `check()` call away from being the
  // only thing standing between an appending agent and a definition that
  // silently replaces another.
  it("rolls back an add that would duplicate an existing definition", () => {
    const before = readFileSync(path, "utf8");
    expect(() => addDef(path, "slot", "draft", 'Text = ""')).toThrowError(/E0007/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses a rename onto an existing name in the same layer", () => {
    const before = readFileSync(path, "utf8");
    expect(() => renameDef(path, "slot.draft", "todos")).toThrowError(/already exists/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("allows a rename onto a name taken in a different layer", () => {
    // Namespaces are per layer, so this is legal — and `E0007` must not make
    // it illegal by accident.
    renameDef(path, "slot.draft", "matchFilter");
    expect(load(path).byQName.has("slot.matchFilter")).toBe(true);
    expect(load(path).byQName.has("fn.matchFilter")).toBe(true);
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

// Every mutator hands back an op-id, and a cascading remove hands back the
// definitions it took with it. The CLI printed both; the MCP tools dropped
// them, so one edit had two different answers depending on which surface
// asked. One function owns the wording now and both surfaces call it, which is
// what makes them agree — this pins the wording, and the MCP suite pins that
// the tools go through it.
describe("describeEdit: the report an edit gives of itself", () => {
  let removedFrom: string | undefined;
  afterEach(() => {
    if (removedFrom) rmSync(dirname(removedFrom), { recursive: true, force: true });
    removedFrom = undefined;
  });

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

  it("stops at the headline when the removal took nothing else", () => {
    const out = describeEdit({
      op: "remove",
      qname: "app.Counter",
      opId: "op_0002",
      removed: ["app.Counter"],
    });
    expect(out).toBe("removed app.Counter  (op_0002)");
  });

  it("carries the op-id out of every other kind of edit", () => {
    expect(describeEdit({ op: "add", qname: "slot.step", opId: "op_1" })).toBe(
      "added slot.step  (op_1)",
    );
    expect(describeEdit({ op: "replace", qname: "slot.step", opId: "op_2" })).toBe(
      "replaced slot.step  (op_2)",
    );
    expect(describeEdit({ op: "edit", qname: "reducer.inc", opId: "op_3" })).toBe(
      "edited reducer.inc  (op_3)",
    );
    expect(
      describeEdit({ op: "rename", qname: "slot.step", newName: "stride", opId: "op_4" }),
    ).toBe("renamed slot.step -> stride  (op_4)");
  });

  it("reports a real cascade off what removeDef returned", () => {
    // The formatter is only as good as the argument it is given: this is the
    // pair as the callers use it, on the file the CLI transcript in the
    // toolchain docs removes from.
    removedFrom = copy(COUNTER);
    const result = removeDef(removedFrom, "slot.count", true);
    expect(result.removed[0]).toBe("slot.count");
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

describe("kumiki fix: auto-patch suggestions", () => {
  it("appends the list accessor a `for` over a Map is missing (E0218)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-for-"));
    const file = join(dir, "formap.kumiki");
    writeFileSync(
      file,
      `slot names : Map(Text, Text) = {}
tile App = column(for k in names text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    expect(patches.map((p) => p.description)).toContain('append ".keys" to "names" at 2:28');
    // The patch has to produce a file that compiles — appending in the wrong
    // place is worse than proposing nothing.
    const patched = patches[0]!.apply(readFileSync(file, "utf8"));
    expect(patched).toContain("for k in names.keys");
    expect(check(parse(lex(patched)))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends the Set accessor, not a prefix of it (E0218)", () => {
    // `.to-list` is two words: a remedy pattern that stopped at the first
    // hyphen would propose `.to`, which parses and means nothing.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-set-"));
    const file = join(dir, "forset.kumiki");
    writeFileSync(
      file,
      `slot tags : Set(Text) = {}
tile App = column(for t in tags text(t))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    expect(patches.map((p) => p.description)).toContain('append ".to-list" to "tags" at 2:28');
    const patched = patches[0]!.apply(readFileSync(file, "utf8"));
    expect(patched).toContain("for t in tags.to-list");
    expect(check(parse(lex(patched)))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("declines when the iterated expression is not a plain name (E0218)", () => {
    // The diagnostic points at where the expression starts, so appending there
    // would produce `pick.keys(names)`. Reported as a skip with its reason
    // rather than repaired wrongly.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-for2-"));
    const file = join(dir, "formap2.kumiki");
    writeFileSync(
      file,
      `slot names : Map(Text, Text) = {}
fn pick(m: Map(Text, Text)) -> Map(Text, Text) = m
tile App = column(for k in pick(names) text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const store = load(file);
    const { patches, skipped } = planFixesExplained(store, check(store.program));
    expect(patches.map((p) => p.code)).not.toContain("E0218");
    expect(skipped.find((sk) => sk.code === "E0218")?.reason).toBe("e0218-target-not-a-plain-name");
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites an out-of-scope $route to the slot that holds it (E0119)", () => {
    // The two name the same route. The bind is only filled in for a route
    // lifecycle reducer, and the slot is readable from all of them — so the
    // repair is the `$`, and the patched file has to compile.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-route-"));
    const file = join(dir, "route.kumiki");
    writeFileSync(
      file,
      `slot seen : Text = ""
reducer clicked on=ui.click(Btn) do= seen := $route.path
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    expect(patches.map((p) => p.description)).toContain(
      'read the "route" slot instead of "$route" at 2:46',
    );
    const patched = patches[0]!.apply(readFileSync(file, "utf8"));
    expect(patched).toContain("seen := route.path");
    expect(check(parse(lex(patched)))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("lands both repairs when one line holds two, and the first shifts the second", () => {
    // `$route` → `route` is a character shorter, so a left-to-right pass moves
    // the second diagnostic's column by one. The regression gate reads a
    // diagnostic as `code@line:col`, so the moved one counted as introduced and
    // the whole plan was rolled back — with the file still holding both errors.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-two-"));
    const file = join(dir, "two.kumiki");
    writeFileSync(
      file,
      `slot seen : Bool = false
reducer clicked on=ui.click(Btn) do= seen := $route.path == $route.pattern
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(2);
    expect(result.remaining).toEqual([]);
    expect(readFileSync(file, "utf8")).toContain("seen := route.path == route.pattern");
    rmSync(dir, { recursive: true, force: true });
  });

  it("lands a line-scanning repair beside a positioned one on the same line", () => {
    // The two families write differently: a name suggestion rewrites the first
    // match on its line, wherever that is, and `$route` → `route` writes at the
    // reported column. Composing them right-to-left by position is not enough —
    // the rightmost `countr` patch rewrites the LEFTMOST one, moves `$route`,
    // and the positioned patch then declines. Every span goes before every
    // line-scan for that reason.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-mixed-"));
    const file = join(dir, "mixed.kumiki");
    writeFileSync(
      file,
      `slot counter : Text = ""
slot seen : Text = ""
reducer clicked on=ui.click(Btn) do= seen := countr + $route.path + countr
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(3);
    expect(result.remaining).toEqual([]);
    expect(readFileSync(file, "utf8")).toContain("seen := counter + route.path + counter");
    rmSync(dir, { recursive: true, force: true });
  });

  it("repairs a diagnostic that does not point at the name it quotes (E0211)", () => {
    // E0211 reports at the start of the selector and names the tile inside it,
    // so there is nothing to measure from and the line is the only handle. This
    // is the whole reason a name suggestion has a line-anchored form at all: a
    // repair that insisted on writing at the reported column would find
    // `ui.click(` there, decline, and take the plan down with it.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-selector-"));
    const file = join(dir, "selector.kumiki");
    writeFileSync(
      file,
      `slot n : Int = 0
reducer inc on=ui.click(Buton) do= n := n + 1
tile Button = button(text="+")
tile App = column(Button, text(n.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`,
    );
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(1);
    expect(result.remaining).toEqual([]);
    expect(readFileSync(file, "utf8")).toContain("on=ui.click(Button)");
    rmSync(dir, { recursive: true, force: true });
  });

  it("names what the gate saw when a diagnostic it cannot repair simply moved", () => {
    // The gate reads a diagnostic as `code@line:col`, so an unrepairable one to
    // the right of a repair that lands looks introduced. Ordering cannot reach
    // this — the message must at least say what it saw, because "it would have
    // introduced new errors" is false here and sends the reader looking for an
    // error that does not exist.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-moved-"));
    const file = join(dir, "moved.kumiki");
    const source = `slot seen : Text = ""
reducer clicked on=ui.click(B) do= seen := $route.path + qqqqqqqqqq
tile B = button(text="go")
tile App = column(B)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    writeFileSync(file, source);
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(result.blocked?.reason).toBe("introduced");
    if (result.blocked?.reason === "introduced") {
      // The same E0103 the file already had, one column to the left.
      expect(result.blocked.introduced.map((e) => `${e.code}@${e.pos.line}:${e.pos.col}`)).toEqual([
        "E0103@2:57",
      ]);
      expect(result.remaining.map((e) => `${e.code}@${e.pos.line}:${e.pos.col}`)).toContain(
        "E0103@2:58",
      );
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves the file's line endings alone", () => {
    // A repair used to round-trip the whole file through
    // `split(/\r?\n/).join("\n")`, so one token's rewrite silently rewrote every
    // CRLF in the file — on the platform where CRLF is the default.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-crlf-"));
    const file = join(dir, "crlf.kumiki");
    const source = [
      'slot counter : Text = ""',
      "reducer clicked on=ui.click(Btn) do= counter := $route.path",
      'tile Btn = button(text="go")',
      "tile App = column(Btn)",
      "app A",
      "    caps   = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init   = []",
      "",
    ].join("\r\n");
    writeFileSync(file, source);
    const result = applyFixPlan(file, undefined);
    expect(result.applied).toBe(1);
    const after = readFileSync(file, "utf8");
    expect(after).toBe(source.replace("$route.path", "route.path"));
    rmSync(dir, { recursive: true, force: true });
  });

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

  it("suggests a close fn name for an undefined call, and applies it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-call-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `slot n : Int = 0
fn double(x: Int) -> Int = x * 2
reducer inc on=ui.click(B) do= n := doubel(n)
tile B = button(text="+")
tile App = column(B, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    expect(patches.map((p) => p.description)).toEqual([`replace "doubel" with "double" at 3:37`]);
    fixCmd(file, true);
    expect(check(load(file).program)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a builtin, not only a declared fn", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-builtin-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `slot t : Text = "Light"
reducer initTheme on=app.start do= t := if prefers-drak() then "Dark" else "Light"
tile App = column(text(t))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    const store = load(file);
    const descs = planFixes(store, check(store.program)).map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "prefers-drak" with "prefers-dark"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close type name for an undefined type, and applies it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-type-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `type Filter = All | Done
slot f : Filtre = All
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    const store = load(file);
    expect(planFixes(store, check(store.program)).map((p) => p.description)).toEqual([
      `replace "Filtre" with "Filter" at 2:10`,
    ]);
    fixCmd(file, true);
    expect(check(load(file).program)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a standard-library type, not only a declared one", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-stdtype-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `slot e : Option(HttpErrro) = None
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    const store = load(file);
    const descs = planFixes(store, check(store.program)).map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "HttpErrro" with "HttpError"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close variant tag for a constructor the union does not have", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-variant-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `type Status = Idle | Running
slot s : Status = Runing
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    const store = load(file);
    expect(planFixes(store, check(store.program)).map((p) => p.description)).toEqual([
      `replace "Runing" with "Running" at 2:19`,
    ]);
    fixCmd(file, true);
    expect(check(load(file).program)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites the reported column, not the line's first word-boundary match", () => {
    // Kumiki names are kebab-case, so `\b` matches at each `-`: the first
    // boundary match for `laod` on this line sits inside `re-laod`, which is
    // defined and was never the name reported.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-col-"));
    const file = join(dir, "broken.kumiki");
    writeFileSync(
      file,
      `slot n : Int = 0
fn re-laod(x: Int) -> Int = x + 1
fn load(x: Int) -> Int = x * 2
reducer go on=ui.click(B) do= n := re-laod(laod(n))
tile B = button(text="+")
tile App = column(B, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`,
    );
    fixCmd(file, true);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("re-laod(load(n))");
    expect(after).toContain("fn re-laod(x: Int)");
    expect(check(load(file).program)).toEqual([]);
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

// `iterStringLiterals` is the shared regex helper feeding both
// `stringLiteralSpans` (numeric-hit rejection) and the partial-string tier.
// The tiers exercise it indirectly, but a direct microtest guards the tricky
// shapes (consecutive literals, escaped quotes, empty body) from refactor
// regressions in the single-source `/"(?:[^"\\]|\\.)*"/g` regex.
describe("iterStringLiterals: shared string-literal walker", () => {
  it("returns spans and raw bodies for a lone literal", () => {
    const lits = iterStringLiterals('x = "hello"');
    expect(lits).toHaveLength(1);
    expect(lits[0]).toMatchObject({ start: 4, end: 11, body: "hello" });
  });

  it("iterates consecutive literals as two separate entries", () => {
    const lits = iterStringLiterals('"a""b"');
    expect(lits.map((l) => l.body)).toEqual(["a", "b"]);
    expect(lits[0]!.end).toBe(lits[1]!.start);
  });

  it('treats an escaped `\\"` inside a literal as part of its body', () => {
    // Regex `"(?:[^"\\]|\\.)*"` must not terminate on the escaped quote.
    const lits = iterStringLiterals('x = "a\\"b" y');
    expect(lits).toHaveLength(1);
    expect(lits[0]!.body).toBe('a\\"b');
  });

  it('yields an entry with an empty body for a bare `""`', () => {
    const lits = iterStringLiterals('x = ""');
    expect(lits).toHaveLength(1);
    expect(lits[0]).toMatchObject({ start: 4, end: 6, body: "" });
  });
});

// M4b+: relaxed literal-repair tiers (issue #156). scope-aware disambiguation,
// non-string leaves, string prefix/suffix, and reducer arithmetic — each with
// enough surrounding source that the store's def line ranges are meaningful.
describe("planTestPatch: relaxed repair tiers", () => {
  function writeAndLoad(source: string): { source: string; store: ReturnType<typeof load> } {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-relax-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(file, source);
    const store = load(file);
    // Caller receives the source verbatim; we don't need the file afterwards.
    rmSync(dir, { recursive: true, force: true });
    return { source, store };
  }

  it("scope-aware: picks the literal inside the target tile when two tiles share it", () => {
    const { source, store } = writeAndLoad(
      [
        'tile A = heading("Helo")',
        'tile B = label("Helo")',
        "test t =",
        "    tile-test A",
        "        given  = {slots: {}}",
        '        expect = heading("Hello")',
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { expected: "Hello", actual: "Helo" },
      },
      [[3, 6]],
      store,
    );
    expect(patch).not.toBeNull();
    const patched = patch?.apply(source) ?? "";
    expect(patched).toContain('tile A = heading("Hello")');
    // Tile B's copy must be left untouched — this is the whole point of the
    // scope-aware disambiguation.
    expect(patched).toContain('tile B = label("Helo")');
  });

  it("scope-aware: null when both hits sit inside the target's own range", () => {
    // Same-tile duplicates are still ambiguous — scope-aware only resolves
    // cross-tile ties.
    const { source, store } = writeAndLoad(
      [
        'tile A = column(heading("Helo"), label("Helo"))',
        "test t =",
        "    tile-test A",
        "        given  = {slots: {}}",
        '        expect = column(heading("Hello"), label("Helo"))',
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { expected: "Hello", actual: "Helo" },
      },
      [[2, 5]],
      store,
    );
    expect(patch).toBeNull();
  });

  it("number leaf: swaps a unique numeric literal in the target reducer", () => {
    // `slot count : Int = 0` + `count := count + 1` reducer; failing test wants
    // the delta to be +2. The exact-literal tier finds `1` uniquely — the
    // scope-aware pass isolates the reducer body.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        'tile B = button(text="+")',
        "test t =",
        "    reducer-test inc",
        "        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 2}}",
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { expected: 2, actual: 1 },
      },
      [[4, 7]],
      store,
    );
    expect(patch).not.toBeNull();
    // Exact-literal tier picks the unique `1` inside the reducer body first,
    // producing `count + 2` — the arithmetic tier would rewrite the same
    // statement identically here, and the exact-literal path wins by priority.
    expect(patch?.apply(source)).toContain("count := count + 2");
  });

  it("boolean leaf: swaps false → true when unique", () => {
    const { source, store } = writeAndLoad(
      [
        "slot flag : Bool = false",
        "reducer flip on=ui.click(B) do= flag := true",
        'tile B = button(text="toggle")',
        "test t =",
        "    reducer-test flip",
        "        given  = {slots: {flag: false}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {flag: false}}",
        "",
      ].join("\n"),
    );
    // Simulate a scenario where `flag` should be `false` after `flip` — the
    // failing leaf reports actual=true / expected=false; `true` appears
    // uniquely inside the reducer body.
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.flag",
        leaf: { expected: false, actual: true },
      },
      [[4, 7]],
      store,
    );
    expect(patch).not.toBeNull();
    expect(patch?.apply(source)).toContain("flag := false");
  });

  it("boolean leaf: swaps true → false in the reverse direction (I4)", () => {
    const { source, store } = writeAndLoad(
      [
        "slot flag : Bool = true",
        "reducer flip on=ui.click(B) do= flag := false",
        'tile B = button(text="toggle")',
        "test t =",
        "    reducer-test flip",
        "        given  = {slots: {flag: true}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {flag: true}}",
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.flag",
        leaf: { expected: true, actual: false },
      },
      [[4, 7]],
      store,
    );
    expect(patch).not.toBeNull();
    expect(patch?.apply(source)).toContain("flag := true");
  });

  it("does not match a numeric leaf inside a string literal (I4)", () => {
    // The failing reducer emits actual=-1; a `text="-1"` on a tile
    // dependency contains the same `-1` characters. The exact-literal tier
    // must NOT rewrite inside the string — that's the very defense the
    // `stringLiteralSpans` filter provides.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer dec on=ui.click(DecBtn) do= count := count - 1",
        'tile DecBtn = button(text="-1")',
        'tile App = column(heading("x"), DecBtn)',
        "test t =",
        "    reducer-test dec",
        "        given  = {slots: {count: 0}, event: {type: ui.click, target: DecBtn}}",
        "        expect = {slots: {count: 1}}",
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { expected: 1, actual: -1 },
      },
      [[5, 8]],
      store,
    );
    // The arithmetic tier rewrites the reducer — not the `text="-1"` string.
    expect(patch).not.toBeNull();
    const patched = patch?.apply(source) ?? "";
    expect(patched).toContain('tile DecBtn = button(text="-1")');
    expect(patched).toMatch(/count := count \+ 1/);
  });

  it("smallest containment: single-digit numeric leaf inside a 3-char string span is rejected", () => {
    // Sibling of the "does not match a numeric leaf inside a string literal"
    // test above, at the *tightest* possible fit: the string literal `"7"`
    // occupies exactly 3 source chars (`"`, `7`, `"`), so the numeric actual
    // `7` lands at digit offset `lo+1` and ends at `hi-1` — the smallest
    // containment case. `combinedExcluded` is only exercised for
    // non-string leaves (numeric / boolean `actualLit`s never contain `"`),
    // so `>=`/`<=` and `>`/`<` are behaviorally identical here; the strict
    // form is a documentation choice, not a behavior change. This test
    // guards against future refactors that widen `combinedExcluded` to
    // string leaves or narrow the filter past the body edges.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        'tile B = button(text="7")',
        'tile App = column(heading("x"), B)',
        "test t =",
        "    reducer-test inc",
        "        given  = {slots: {count: 6}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 8}}",
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { expected: 8, actual: 7 },
      },
      [[5, 8]],
      store,
    );
    expect(patch).not.toBeNull();
    const patched = patch?.apply(source) ?? "";
    // The literal `text="7"` survives verbatim — the boundary filter kept the
    // digit `7` off the exact-literal candidate list.
    expect(patched).toContain('tile B = button(text="7")');
    // The arithmetic tier rewrote the reducer to hit expected=8.
    expect(patched).toMatch(/count := count \+ 2/);
  });

  it("prefix/suffix: swaps the divergent middle inside a shared string literal", () => {
    const { source, store } = writeAndLoad(
      [
        'tile Greet = heading("Hello, world")',
        "test t =",
        "    tile-test Greet",
        "        given  = {slots: {}}",
        '        expect = heading("Hi, world")',
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { expected: "Hi, world", actual: "Hello, world" },
      },
      [[2, 5]],
      store,
    );
    expect(patch).not.toBeNull();
    expect(patch?.apply(source)).toContain('tile Greet = heading("Hi, world")');
  });

  it("arithmetic: flips + to - when the sign of the delta is wrong", () => {
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer dec on=ui.click(B) do= count := count + 1",
        'tile B = button(text="-")',
        "test t =",
        "    reducer-test dec",
        "        given  = {slots: {count: 5}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 4}}",
        "",
      ].join("\n"),
    );
    // Reducer added +1 (actual=6), but the test expects 4 (base 5 − 1).
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { expected: 4, actual: 6 },
      },
      [[4, 7]],
      store,
    );
    expect(patch).not.toBeNull();
    expect(patch?.apply(source)).toContain("count := count - 1");
  });

  it("arithmetic: rewrites the multiplier when count := count * n needs a different n", () => {
    // Multiplicative-tier positive case. Reducer: `count := count * 5`, given
    // count=2 → actual=10; expected=6. Recovers base = 10/5 = 2, newN = 6/2 =
    // 3 → rewrites to `count := count * 3`. Tier-1 misses because `10` never
    // appears in source.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer mul on=ui.click(B) do= count := count * 5",
        'tile B = button(text="mul")',
        "test t =",
        "    reducer-test mul",
        "        given  = {slots: {count: 2}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 6}}",
        "",
      ].join("\n"),
    );
    const patch = planTestPatch(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { expected: 6, actual: 10 },
      },
      [[4, 7]],
      store,
    );
    expect(patch).not.toBeNull();
    const patched = patch?.apply(source) ?? "";
    expect(patched).toContain("count := count * 3");
    expect(patched).not.toContain("count := count * 5");
    expect(patch?.description).toContain("count := count * 5");
    expect(patch?.description).toContain("count := count * 3");
  });

  // The partial-string tier compares `midA` (decoded from `TestResult`)
  // against literal bodies drawn straight from raw source. When the divergent
  // middle IS an escape char (`\n \t \r \" \\`), raw source spells it as two
  // chars (`\` + `n`) while `midA` carries the real control char. The tier
  // must decode literal bodies before comparing, and re-encode after splicing.
  //
  // Every scenario below wraps the failing text inside a LARGER source literal
  // (`"outer ... outer"`) so Tier-1's exact-literal search misses and Tier-2
  // is forced to run — that's where the escape-encoding asymmetry lives.
  describe("partial-string: escape-normalized matching", () => {
    it("rewrites when the divergent middle IS a real newline (source spells \\n)", () => {
      // Wrapping literal `"outer foo\nbar outer"` (raw, `\n` = 2 chars).
      // actual="foo\nbar" (real NL), expected="foo bar" — Tier-1 misses because
      // no source literal spells `"foo\nbar"` on its own. Tier-2:
      //   affixDiff → pfx="foo", sfx="bar", midA="\n" (real NL), midE=" ".
      // Old code: `m[0].includes(realNL)` on raw body → false → bail. New code
      // decodes the body first → match, splice, re-encode.
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer foo\\nbar outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer foo bar outer")',
          "",
        ].join("\n"),
      );
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "foo bar", actual: "foo\nbar" },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      const patched = patch?.apply(source) ?? "";
      expect(patched).toContain('tile Greet = heading("outer foo bar outer")');
    });

    it("rewrites when the divergent middle IS a real tab (source spells \\t)", () => {
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer foo\\tbar outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer foo bar outer")',
          "",
        ].join("\n"),
      );
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "foo bar", actual: "foo\tbar" },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      expect(patch?.apply(source)).toContain('tile Greet = heading("outer foo bar outer")');
    });

    it("rewrites when the divergent middle IS a real CR (source spells \\r)", () => {
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer foo\\rbar outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer foo bar outer")',
          "",
        ].join("\n"),
      );
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "foo bar", actual: "foo\rbar" },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      expect(patch?.apply(source)).toContain('tile Greet = heading("outer foo bar outer")');
    });

    it('rewrites when the divergent middle IS a real quote (source spells \\")', () => {
      // pfx="say ", sfx=" now", midA='"', midE="!".
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer say \\" now outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer say ! now outer")',
          "",
        ].join("\n"),
      );
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "say ! now", actual: 'say " now' },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      expect(patch?.apply(source)).toContain('tile Greet = heading("outer say ! now outer")');
    });

    it("rewrites when the divergent middle IS a real backslash (source spells \\\\)", () => {
      // pfx="a", sfx="b", midA="\", midE="/".
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer a\\\\b outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer a/b outer")',
          "",
        ].join("\n"),
      );
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "a/b", actual: "a\\b" },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      expect(patch?.apply(source)).toContain('tile Greet = heading("outer a/b outer")');
    });

    it("preserves other escapes in the un-touched portion when repairing (canonical re-encode)", () => {
      // Round-trip guard: source has an unrelated `\n` outside the divergent
      // region. The old code spliced decoded `midE` into raw `body` and passed
      // the mixed result to `kumikiStringLit`, which encoded existing raw `\n`
      // (two chars) as `\\n` (four chars) — a silent corruption. The new
      // decoded-space splice must produce a canonical single `\n` on output.
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer head\\nfoo tail outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer head\\nbar tail outer")',
          "",
        ].join("\n"),
      );
      // midA="foo", midE="bar" — plain ASCII. The `\n` in the shared prefix
      // must round-trip as a single `\n` escape (not `\\n`).
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "head\nbar tail", actual: "head\nfoo tail" },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      const patched = patch?.apply(source) ?? "";
      expect(patched).toContain('tile Greet = heading("outer head\\nbar tail outer")');
      expect(patched).not.toContain("head\\\\n");
    });

    it("emits `\\n` in the output when midE injects a real newline into a source with no escapes", () => {
      // Complement to the source-side-escape cases: source spells no escapes,
      // midA is plain ASCII, but midE brings a real newline. The re-encoded
      // literal must contain the 2-char `\n` escape, not a bare NL that would
      // break the surrounding kumiki syntax. midA is a unique token in the
      // body so the position picker is unambiguous.
      const { source, store } = writeAndLoad(
        [
          'tile Greet = heading("outer XYZ outer")',
          "test t =",
          "    tile-test Greet",
          "        given  = {slots: {}}",
          '        expect = heading("outer AB\\nCD outer")',
          "",
        ].join("\n"),
      );
      const patch = planTestPatch(
        source,
        {
          name: "t",
          pass: false,
          diffAt: "heading.text",
          leaf: { expected: "AB\nCD", actual: "XYZ" },
        },
        [[2, 5]],
        store,
      );
      expect(patch).not.toBeNull();
      const patched = patch?.apply(source) ?? "";
      expect(patched).toContain('tile Greet = heading("outer AB\\nCD outer")');
      // A bare NL inside a `"..."` literal would break kumiki syntax.
      expect(patched).not.toMatch(/"outer AB\nCD/);
    });
  });
});

// M4b+: expanded `planFixes` name-suggestion and E0301 caps-injection.
describe("planFixes: expanded auto-patch coverage", () => {
  it("suggests a close motion name for E0107", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0107-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "motion fadeIn = {keyframes: {from: {opacity: 0}, to: {opacity: 1}}}",
        'tile App = heading("hi") {motion: "fadeInn"}',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const errors = check(store.program);
    const patches = planFixes(store, errors);
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "fadeInn" with "fadeIn"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close tile name for E0211 (undef tile in a lifecycle event)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0211-lifecycle-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot mounts : Int = 0",
        'tile Panel = card(text("p"))',
        "reducer onPanel on=tile.mount(Pannel) do= mounts := mounts + 1",
        "tile App = column(Panel)",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "Pannel" with "Panel"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close standard-effect name for E0104", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0104-builtin-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot n : Int = 0",
        'tile Btn = button(text="go", onClick=go)',
        'reducer go on=ui.click(Btn) do= emit navigat({path: "/x", params: {}})',
        "tile App = column(Btn)",
        "app A",
        "    caps   = [nav.push]",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    const descs = patches.map((p) => p.description);
    // The standard effects are in no definition list, so before they were a
    // candidate set of their own this had no proposal at all.
    expect(descs.some((d) => d.includes(`replace "navigat" with "navigate"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close effect name for an on=<effect>.ok selector", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0104-selector-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot n : Int = 0",
        "effect load cap=http.get in=Unit out=Result(Text, HttpError)",
        "reducer got on=laod.ok($v, _) do= n := 1",
        'tile App = column(text("hi"))',
        "app A",
        "    caps   = [http.get]",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "laod" with "load"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close reducer name for an app.http handler", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0102-http-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot n : Int = 0",
        "reducer onUnauth on=app.start do= n := 1",
        'tile App = column(text("hi"))',
        "app A",
        "    caps   = [http.get]",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        '    http   = {base-url: "/api", on-401: onUnath}',
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "onUnath" with "onUnauth"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close slot name for E0118, not only a theme name", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0118-slot-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        'slot themeName : Text = "Light"',
        'theme Light = {colors: {bg: "#fff"}}',
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "    theme  = themeNam",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "themeNam" with "themeName"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close theme or slot name for E0118", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0118-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        'theme Light = {colors: {bg: "#fff"}}',
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "    theme  = Ligth",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "Ligth" with "Light"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close tile name for E0211 (undef tile in ui.click selector)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0211-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        'tile IncBtn = button(text="+")',
        "reducer inc on=ui.click(IncBtnn) do= count := count + 1",
        "tile App = column(IncBtn)",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const errors = check(store.program);
    const patches = planFixes(store, errors);
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "IncBtnn" with "IncBtn"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a missing capability to app.caps for E0301", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0301-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    // Sanity: without a fix, the file has E0301.
    const preErrors = check(load(file).program);
    expect(preErrors.some((e) => e.code === "E0301")).toBe(true);
    const result = applyFixPlan(file, "E0301");
    expect(result.applied).toBeGreaterThan(0);
    const after = readFileSync(file, "utf8");
    // The caps array now contains `log.write`.
    expect(after).toMatch(/caps\s*=\s*\[[^\]]*\blog\.write\b[^\]]*\]/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps merge is idempotent — adding an existing cap is a no-op patch (C5)", () => {
    // The `appendAppCap` helper must return null (patch not offered) when the
    // cap is already present, so we never report `applied: N` for a no-op.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-idem-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "app A",
        "    caps   = [log.write]",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    // Cap already present → file already clean → no patch to apply.
    const result = applyFixPlan(file, "E0301");
    expect(result.applied).toBe(0);
    expect(result.remaining).toEqual([]);
  });

  it("suggests a close timer name for E0106", () => {
    // Timer `countdown` is declared; `stop-timer(coutdown)` is a Levenshtein-1
    // typo. The candidate set is the timer namespace (built from
    // `collectTimerNames`), not top-level defs — but even the correct name is
    // there, so the assertion is the positive one.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0106-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot remaining : Int = 5",
        "reducer tick on=timer(100ms, name=countdown) do= remaining := remaining - 1",
        "reducer stop on=ui.click(StopBtn) do= stop-timer(coutdown)",
        'tile StopBtn = button(text="Stop", onClick=stop)',
        'tile App = column(heading("hi"), StopBtn)',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0106")).toBe(true);
    const patches = planFixes(store, errors);
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "coutdown" with "countdown"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("E0106 does not fall back to unrelated top-level names (scoped candidate set)", () => {
    // Timer `tick` is declared; `stop-timer(nope)` is a 4-edit typo — too far
    // from any timer name to pass the suggestion threshold. Top-level `slot
    // note` sits at Levenshtein 1 from `nope`, so the pre-#175 unscoped code
    // path would have proposed `note` — a silent corruption. The scoped
    // candidate set (only `{tick}`) must reject all E0106 patches instead.
    //
    // The direct assertions on `collectTimerNames` and every patch
    // description below are the load-bearing ones: a bare "no E0106 patch"
    // check would also pass if `collectTimerNames` silently returned an
    // empty set — reviewer C1 flagged that as a bug-hiding shape.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0106-scope-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot note  : Int = 0",
        "slot count : Int = 0",
        "reducer step on=timer(100ms, name=tick) do= count := count + 1",
        "reducer stop on=ui.click(StopBtn) do= stop-timer(nope)",
        'tile StopBtn = button(text="Stop", onClick=stop)',
        'tile App = column(heading("hi"), StopBtn)',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    // The candidate set is exactly the timer namespace — no top-level defs.
    expect(collectTimerNames(store.program)).toEqual(new Set(["tick"]));
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0106")).toBe(true);
    const patches = planFixes(store, errors);
    expect(patches.some((p) => p.code === "E0106")).toBe(false);
    // Belt-and-braces: even if a future code path re-enables generic
    // suggestions for this code, no proposed patch may name `note` / `count`.
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`"note"`))).toBe(false);
    expect(descs.some((d) => d.includes(`"count"`))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close variant tag for E0209 on a user union", () => {
    // Union `Light = Red | Green`; `| Grn ->` is a 2-edit typo of `Green` and
    // passes the ≤ 2 threshold. Top-level tile `Grn0` sits at Levenshtein 1
    // from `Grn`, so the pre-#175 unscoped path would have suggested `Grn0`.
    // The scoped candidate set (variants of `Light`) must pick `Green`.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0209-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "type Light = Red | Green",
        "fn label(l: Light) -> Text = match l with",
        '  | Red -> "STOP"',
        '  | Grn -> "GO"',
        "slot x : Int = 0",
        'tile Grn0 = text("hi")',
        "tile App = column(text(x.show), Grn0)",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0209")).toBe(true);
    const patches = planFixes(store, errors);
    const e0209 = patches.filter((p) => p.code === "E0209");
    expect(e0209.length).toBe(1);
    expect(e0209[0]?.description).toContain(`replace "Grn" with "Green"`);
    expect(e0209[0]?.description).not.toContain("Grn0");
    rmSync(dir, { recursive: true, force: true });
  });

  it("E0209 does not fall back to unrelated top-level names (scoped candidate set)", () => {
    // Union `Direction = North | South`; typo `Qqq` is ≥ 5 edits from either
    // variant — beyond the threshold. Top-level tile `Qqq0` sits at
    // Levenshtein 1 from `Qqq`, so the pre-#175 unscoped path would have
    // suggested `Qqq0` (a silent corruption of the pattern). The scoped
    // candidate set must reject every E0209 patch.
    //
    // As with the E0106 scope-safety test, the direct `variantTagsOf`
    // assertion and the description exclusion below are what distinguishes
    // "correctly rejected by threshold" from "silently skipped" (reviewer
    // C1).
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0209-scope-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "type Direction = North | South",
        "fn describe(d: Direction) -> Text = match d with",
        '  | North -> "n"',
        '  | South -> "s"',
        '  | Qqq   -> "?"',
        "slot x : Int = 0",
        'tile Qqq0 = text("hi")',
        "tile App = column(text(x.show), Qqq0)",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    // The candidate set is exactly the union's variant tags — top-level
    // `Qqq0` is not a candidate.
    expect(variantTagsOf("Direction", store.program)).toEqual(["North", "South"]);
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0209")).toBe(true);
    const patches = planFixes(store, errors);
    expect(patches.some((p) => p.code === "E0209")).toBe(false);
    // A proposed patch that names `Qqq0` is exactly the corruption we're
    // guarding against; assert on the description text so a future set
    // widening of NAME_SUGGEST_CODES can't reintroduce it.
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes("Qqq0"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("suggests a close variant tag for E0209 on a built-in Option scrutinee", () => {
    // Built-in unions (`Option(T)` / `Result(T, E)`) are also covered — the
    // scoped candidate set for `Option` is `{Some, None}` regardless of the
    // instantiated type argument. `Non` -> `None` (distance 1) passes the
    // ≤ 2 threshold.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-e0209-option-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "fn describe(o: Option(Int)) -> Text = match o with",
        '  | Some(_) -> "some"',
        '  | Non    -> "none"',
        "slot x : Int = 0",
        "tile App = column(text(x.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const errors = check(store.program);
    expect(errors.some((e) => e.code === "E0209")).toBe(true);
    const patches = planFixes(store, errors);
    const descs = patches.map((p) => p.description);
    expect(descs.some((d) => d.includes(`replace "Non" with "None"`))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps merge preserves existing entries", () => {
    // `[storage.read]` + new `log.write` → `[storage.read, log.write]`. Verifies
    // we're not clobbering the array, and that the new cap lands in the same
    // one-line array (not on a new line).
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-merge-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        "effect loadX cap=storage.read",
        "             in=Unit",
        "             out=Result(Text, Text)",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "app A",
        "    caps   = [storage.read]",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const result = applyFixPlan(file, "E0301");
    expect(result.applied).toBeGreaterThan(0);
    const after = readFileSync(file, "utf8");
    expect(after).toMatch(/caps\s*=\s*\[storage\.read,\s*log\.write\]/);
  });
});

// M4b+ / #156 review C4: regression gate.
describe("applyFixPlan: regression gate", () => {
  it("clean patch: writes through and reports not-blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-regression-ok-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const result = applyFixPlan(file, "E0001");
    // The E0001 patch cleanly clears the diagnostic → applied, not blocked.
    expect(result.regressionBlocked).toBeFalsy();
    expect(result.applied).toBeGreaterThan(0);
    expect(readFileSync(file, "utf8")).not.toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });

  it("swap E0301 → E0302 (typo cap): blocked, file byte-identical", () => {
    // The very case the count-only guard would miss: an effect declared with
    // a non-standard `cap=lgo` produces E0301 "missing capability lgo". Adding
    // `lgo` to app.caps clears the E0301 but immediately triggers E0302
    // "unknown-capability lgo". Diagnostic count stays 1; the set-difference
    // gate must catch this as a 1-for-1 swap and roll back.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-regression-swap-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=lgo",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const result = applyFixPlan(file, "E0301");
    expect(result.regressionBlocked).toBe(true);
    expect(result.applied).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });

  it("no resolutions: rolled back even when nothing new is introduced", () => {
    // A `suggestName` that finds no viable neighbor emits no patch, so this
    // case doesn't naturally arise from planFixes. Directly construct a plan
    // via `applyFixPlan` with a code that has no repair — the pre-existing
    // errors survive and we assert the file wasn't touched.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-regression-noop-"));
    const file = join(dir, "in.kumiki");
    // Only an unrepairable error (E0601 duplicate-write is not in planFixes).
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer bad on=ui.click(B) do=",
        "    count := 1",
        "    count := 2",
        'tile B = button(text="+")',
        'tile App = column(heading("hi"), B)',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const result = applyFixPlan(file, undefined);
    // No patches available → applied 0, remaining preserves original errors.
    expect(result.applied).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });
});

// `writeFileSync` at three sites in fix.ts must not leak EACCES / ENOSPC /
// EBUSY as raw stacks. Callers of `applyFixPlan` and `runFixFromTest` should
// observe I/O failure as structured return values — symmetric with the
// existing `parseError` / `regressionBlocked` / `testRunError` paths — and
// the on-disk file must be byte-identical thanks to the atomic tmp+rename
// helper (a mid-write throw never truncates the target).
describe("write-failure handling", () => {
  it("applyFixPlan: writeFileSync throws → writeError set, applied=0, file byte-identical", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-writefail-apply-"));
    const file = join(dir, "in.kumiki");
    // E0301 (missing capability log.write) has a deterministic auto-patch.
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EACCES: simulated write failure");
    });
    try {
      const result = applyFixPlan(file, "E0301");
      expect(result.writeError).toBeDefined();
      expect(result.writeError).toContain("EACCES");
      expect(result.applied).toBe(0);
      // `atomicWriteFileSync` stages into a sibling tmp file and renames; a
      // throw on the staging write leaves the target byte-identical.
      expect(readFileSync(file, "utf8")).toBe(before);
      // No regression rollback (that path is short-circuited before the write).
      expect(result.regressionBlocked).toBeFalsy();
      expect(result.parseError).toBeUndefined();
    } finally {
      writeSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runFixFromTest: Tier-1 (compile) write throws → status=write-failed, phase=compile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-writefail-compile-"));
    const file = join(dir, "in.kumiki");
    // E0301 auto-fixable (effect requires `log.write`; app.caps is empty) plus
    // an unrelated test-def — Tier-1 wants to write compile patches before
    // running any test. We block that write; the test def never gets reached.
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        'tile B = button(text="+")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test inc",
        "        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 1}}",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("ENOSPC: simulated no space");
    });
    try {
      const outcome = await runFixFromTest(file, "t", true);
      expect(outcome.status).toBe("write-failed");
      if (outcome.status === "write-failed") {
        expect(outcome.phase).toBe("compile");
        expect(outcome.writeError).toContain("ENOSPC");
        expect(outcome.compileFixes).toBeGreaterThan(0);
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      writeSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runFixFromTest: Tier-2 (test) write throws → status=write-failed, phase=test, patch preserved", async () => {
    // Clean-compiling file with a failing test that has a deterministic
    // Tier-2 (arithmetic) patch. Only the final write must throw.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-writefail-test-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer dec on=ui.click(B) do= count := count + 1",
        'tile B = button(text="-")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test dec",
        "        given  = {slots: {count: 5}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 4}}",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EBUSY: simulated busy");
    });
    try {
      const outcome = await runFixFromTest(file, "t", true);
      expect(outcome.status).toBe("write-failed");
      if (outcome.status === "write-failed") {
        expect(outcome.phase).toBe("test");
        expect(outcome.writeError).toContain("EBUSY");
        expect(outcome.patch).toBeDefined();
        expect(outcome.patch?.description).toContain("count := count");
        // No Tier-1 fixes ran (file compiles cleanly), so `compileFixes` absent.
        expect(outcome.compileFixes).toBeUndefined();
      }
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      writeSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runFixFromTest: Tier-1 write lands, Tier-2 write throws → write-failed / phase=test carries compileFixes", async () => {
    // The two-write flow: Tier-1 fixes E0301 successfully, then Tier-2 tries
    // to write the behavioral patch and throws. The outcome must carry the
    // Tier-1 count on the write-failed variant so the printer can honestly
    // report "applied N compile fix(es)" ahead of the write-failed line.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-writefail-tier1-then-tier2-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        // E0301 (missing capability log.write): Tier-1 will inject `log.write`
        // into `app.caps` — a single successful write that lands cleanly.
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        // Then a compiling test that Tier-2 can patch (arithmetic tier).
        "slot count : Int = 0",
        "reducer dec on=ui.click(B) do= count := count + 1",
        'tile B = button(text="-")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test dec",
        "        given  = {slots: {count: 5}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 4}}",
        "",
      ].join("\n"),
    );
    // Grab the underlying writeFileSync BEFORE spying so the first call can
    // pass through to disk. Since `vi.mock("node:fs")` returns a spread of
    // `actual`, `fs.writeFileSync` already IS the real function reference.
    const realWrite = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    writeSpy
      .mockImplementationOnce((...args: Parameters<typeof fs.writeFileSync>) => {
        realWrite(...args);
      })
      .mockImplementation(() => {
        throw new Error("EBUSY: second-write simulated");
      });
    try {
      const outcome = await runFixFromTest(file, "t", true);
      expect(outcome.status).toBe("write-failed");
      if (outcome.status === "write-failed") {
        expect(outcome.phase).toBe("test");
        expect(outcome.writeError).toContain("EBUSY");
        expect(outcome.patch).toBeDefined();
        expect(outcome.compileFixes).toBeGreaterThan(0);
      }
      // Tier-1 write DID land — file now has `caps = [log.write]`.
      expect(readFileSync(file, "utf8")).toContain("log.write");
    } finally {
      writeSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fixCmd (top-level CLI): writeError sets exitCode=1 and prints on stderr", () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fixcmd-writefail-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const before = readFileSync(file, "utf8");
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EACCES: simulated fixCmd");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The code is returned rather than written to `process.exitCode`: this
      // call is in-process, and a function that set the exit code as a side
      // effect would fail the vitest worker that called it.
      const code = fixCmd(file, true);
      const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderr).toContain(`could not write fixes to ${file}`);
      expect(stderr).toContain("EACCES");
      expect(code).toBe(1);
      // On-disk file unchanged.
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally {
      writeSpy.mockRestore();
      errSpy.mockRestore();
      logSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
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
    const first = addDef(path, "slot", "lastSync", "Option(Time) = None");
    const second = addDef(path, "slot", "prevSync", "Option(Time) = None");
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
    const first = addDef(path, "slot", "lastSync", "Option(Time) = None");
    const second = addDef(path, "slot", "prevSync", "Option(Time) = None");
    expect(first).toMatch(/^op_[0-9A-HJ-NP-TV-Z]{26}$/);
    expect(second).toMatch(/^op_[0-9A-HJ-NP-TV-Z]{26}$/);
    // Time-prefix (chars 3..13) must be non-decreasing across calls.
    expect(second.slice(3, 13) >= first.slice(3, 13)).toBe(true);
  });

  it("honors KUMIKI_AUTHOR for the author field", () => {
    const prev = process.env.KUMIKI_AUTHOR;
    process.env.KUMIKI_AUTHOR = "agent:claude-7";
    try {
      addDef(path, "slot", "lastSync", "Option(Time) = None");
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
      { op: "add", layer: "slot", name: "lastSync", body: "Option(Time) = None" },
      { op: "replace", layer: "slot", name: "lastSync", body: "Option(Time) = Some(now)" },
    ];
    writeFileSync(opsFile, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    const ids = patchApplyFile(path, opsFile);
    expect(ids).toHaveLength(2);
    const store = load(path);
    expect(viewDef(store, "slot.lastSync")).toContain("= Some(now)");
  });

  it("rolls back the file when any op in the bundle fails", () => {
    const before = readFileSync(path, "utf8");
    const opsFile = join(dirname(path), "ops.jsonl");
    const ops = [
      { op: "add", layer: "slot", name: "lastSync", body: "Option(Time) = None" },
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
      { op: "add", layer: "slot", name: "lastSync", body: "Option(Time) = None" },
      { op: "add", layer: "tile", name: "Broken", body: "column(Nonexistent)" },
    ];
    writeFileSync(opsFile, `${ops.map((o) => JSON.stringify(o)).join("\n")}\n`);
    expect(() => patchApplyFile(path, opsFile)).toThrow();
    expect(exists(`${path}.kumiki-ops.jsonl`)).toBe(false);
  });

  it("reverts an add op via patchRevert", () => {
    const id = addDef(path, "slot", "lastSync", "Option(Time) = None");
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
    addDef(path, "slot", "lastSync", "Option(Time) = None");
    replaceDef(path, "slot.lastSync", "Option(Time) = Some(now)");
    replaceDef(path, "slot.lastSync", "Option(Time) = None");
    addDef(path, "slot", "other", "Option(Time) = None"); // irrelevant
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
    expect(() => addDef(path, "slot", "lastSync", "Option(Time) = None")).not.toThrow();
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
    addDef(aFirst, "slot", "lastSync", "Option(Time) = None");
    renameDef(aFirst, "slot.draft", "newDraft");

    renameDef(bFirst, "slot.draft", "newDraft");
    addDef(bFirst, "slot", "lastSync", "Option(Time) = None");

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

// Every silent skip in `planFixes` / `planTestPatch` must surface a stable
// kebab-case classifier so the AI iteration loop can distinguish "no
// deterministic repair exists" from "compiler diagnostic format drifted". The
// classifier is also emitted via `KUMIKI_DEBUG=fix` and printed by
// `printFixFromTest`; the tests below pin each identifier so a rename or
// silent bail can't slip past review.
describe("planFixesExplained: skip-reason classification", () => {
  function writeAndLoad(source: string): ReturnType<typeof load> {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-reason-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(file, source);
    const store = load(file);
    rmSync(dir, { recursive: true, force: true });
    return store;
  }

  // Some skip reasons can't be triggered end-to-end via a real compiler
  // diagnostic (e.g. "quoted-name-extract-failed" requires the compiler to
  // stop quoting the missing name, which no shipping version does). Those
  // branches are covered by injecting a synthetic KumikiError.
  const synth = (code: string, message: string) => ({
    code,
    kind: "type-error" as const,
    message,
    pos: { line: 1, col: 1 },
  });

  it("quoted-name-extract-failed: NAME_SUGGEST message without a quoted name", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0102", "reducer name is undefined"),
    ]);
    expect(patches).toEqual([]);
    expect(skipped[0]?.reason).toBe("quoted-name-extract-failed");
    expect(skipped[0]?.code).toBe("E0102");
  });

  it("no-close-name-suggestion: NAME_SUGGEST typo too far from any candidate", () => {
    // Only a `tile A` — a typo like "ZZZZZZZZZZ" is beyond the Levenshtein
    // threshold for every def in the store, so no suggestion survives.
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0102", 'reducer refers to undefined name "ZZZZZZZZZZ"'),
    ]);
    expect(patches).toEqual([]);
    expect(skipped.find((s) => s.reason === "no-close-name-suggestion")).toBeDefined();
  });

  it("no-close-name-suggestion: missing name equals the only candidate (self-match gate)", () => {
    // Regression pin for `suggestNameFrom`'s self-skip. Without it, a
    // diagnostic that quotes a name that IS a top-level def name would
    // produce a `replace "A" with "A"` no-op patch. Self is skipped in the
    // loop, so with no other candidate the sweep leaves `best` null.
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0102", 'reducer refers to undefined name "A"'),
    ]);
    expect(patches).toEqual([]);
    const s = skipped.find((r) => r.reason === "no-close-name-suggestion");
    expect(s).toBeDefined();
    expect(s?.code).toBe("E0102");
  });

  it("self-match does not eclipse a close alternative candidate", () => {
    // With a self-match at distance 0 AND a genuinely close alternative,
    // `suggestNameFrom` must skip self and still surface the alternative
    // (here `Apps` at distance 1 from `App`). A naive `bestScore === 0`
    // bail after the loop would drop the alternative too — this pins that
    // it does not.
    const store = writeAndLoad(
      ['tile App = heading("hi")', 'tile Apps = label("hi")', ""].join("\n"),
    );
    const { patches } = planFixesExplained(store, [
      synth("E0102", 'reducer refers to undefined name "App"'),
    ]);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.description).toContain('replace "App" with "Apps"');
  });

  it("e0106-quoted-name-extract-failed: E0106 without a quoted name", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { skipped } = planFixesExplained(store, [synth("E0106", "stop-timer bad")]);
    expect(skipped[0]?.reason).toBe("e0106-quoted-name-extract-failed");
  });

  it("e0106-empty-timer-namespace: E0106 fired but no timers declared", () => {
    // No `on=timer(...)` anywhere → `collectTimerNames` returns an empty set.
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { skipped } = planFixesExplained(store, [
      synth("E0106", 'stop-timer refers to undefined timer name "x"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0106-empty-timer-namespace");
  });

  it("e0106-no-close-timer: typo too far from every declared timer", () => {
    const store = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer step on=timer(100ms, name=tick) do= count := count + 1",
        'tile App = heading("hi")',
        "",
      ].join("\n"),
    );
    const { skipped } = planFixesExplained(store, [
      synth("E0106", 'stop-timer refers to undefined timer name "ZZZZZZZZZZ"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0106-no-close-timer");
  });

  it("e0209-quoted-name-extract-failed: E0209 with fewer than 2 quoted names", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { skipped } = planFixesExplained(store, [synth("E0209", 'Variant "X" is bad')]);
    expect(skipped[0]?.reason).toBe("e0209-quoted-name-extract-failed");
  });

  it("e0209-unresolved-variant-type: type name has no variant tags in the program", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { skipped } = planFixesExplained(store, [
      synth("E0209", 'Variant "X" is not a member of scrutinee type "NoSuchType"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0209-unresolved-variant-type");
  });

  it("e0209-no-close-tag: quoted variant too far from every union tag", () => {
    const store = writeAndLoad(
      ["type Light = Red | Green", "slot x : Int = 0", 'tile App = heading("hi")', ""].join("\n"),
    );
    const { skipped } = planFixesExplained(store, [
      synth("E0209", 'Variant "ZZZZZZZZZZ" is not a member of scrutinee type "Light"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0209-no-close-tag");
  });

  it("e0116-quoted-name-extract-failed: E0116 message without a quoted name", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0116", "call to something undefined"),
    ]);
    expect(patches).toEqual([]);
    expect(skipped[0]?.reason).toBe("e0116-quoted-name-extract-failed");
  });

  it("e0116-no-close-callee: typo too far from every fn and builtin", () => {
    const store = writeAndLoad(
      ["fn double(x: Int) -> Int = x * 2", 'tile App = heading("hi")', ""].join("\n"),
    );
    const { skipped } = planFixesExplained(store, [
      synth("E0116", 'Call to undefined function "ZZZZZZZZZZ"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0116-no-close-callee");
  });

  it("e0116: a close slot name is not a candidate, so no patch is proposed", () => {
    // The whole point of the scoped candidate set: `doubel` is one edit from
    // the slot `double`, but a slot cannot be called, so proposing it would
    // produce E0116 again and burn a repair round.
    const store = writeAndLoad(
      ["slot doubel-value : Int = 0", 'tile App = heading("hi")', ""].join("\n"),
    );
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0116", 'Call to undefined function "doubel-value"'),
    ]);
    expect(patches).toEqual([]);
    expect(skipped[0]?.reason).toBe("e0116-no-close-callee");
  });

  it("e0116: a misspelt type member is answered on its own qualifier", () => {
    // `fresh` / `parse` / `show` resolve on any capitalised qualifier, so there
    // is no table of qualified spellings to suggest from — the candidate is
    // built from the qualifier the author wrote. Without it, `Int.pasre` had no
    // repair at all: the callee list is `fn` names and unqualified builtins.
    //
    // Run end to end rather than from a synthesised diagnostic: the two joins
    // that can break are the message shape the compiler emits for a qualified
    // callee, and whether `replaceAt` — which splices at an exact column —
    // rewrites a dotted name.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-fix-qualified-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot a : Int = 0",
        'slot t : Text = "1"',
        "reducer r on=ui.click(B) do= a := Int.pasre(t).get-or(0)",
        'tile B = button(text="b")',
        "tile App = column(B, text(a.show), text(t))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const store = load(file);
    const patches = planFixes(store, check(store.program));
    expect(patches.map((p) => p.description)).toContain(
      'replace "Int.pasre" with "Int.parse" at 3:35',
    );
    const patched = patches[0]!.apply(readFileSync(file, "utf8"));
    expect(patched).toContain("a := Int.parse(t).get-or(0)");
    expect(check(parse(lex(patched)))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("e0117-quoted-name-extract-failed: E0117 message without a quoted name", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { patches, skipped } = planFixesExplained(store, [synth("E0117", "some undefined type")]);
    expect(patches).toEqual([]);
    expect(skipped[0]?.reason).toBe("e0117-quoted-name-extract-failed");
  });

  it("e0117-no-close-type: typo too far from every type name", () => {
    const store = writeAndLoad(
      ["type Filter = All | Done", 'tile App = heading("hi")', ""].join("\n"),
    );
    const { skipped } = planFixesExplained(store, [
      synth("E0117", 'Reference to undefined type "ZZZZZZZZZZ"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0117-no-close-type");
  });

  it("e0117: a close slot name is not a candidate, so no patch is proposed", () => {
    // Same namespace argument as E0116: `Filtr` is one edit from the slot
    // `Filtar`, but a slot name in a type position is E0117 again.
    const store = writeAndLoad(
      ["slot Filtar : Int = 0", 'tile App = heading("hi")', ""].join("\n"),
    );
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0117", 'Reference to undefined type "Filtar"'),
    ]);
    expect(patches).toEqual([]);
    expect(skipped[0]?.reason).toBe("e0117-no-close-type");
  });

  it("e0216-quoted-name-extract-failed: E0216 message without both quoted names", () => {
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { skipped } = planFixesExplained(store, [synth("E0216", 'Variant "Zork" is unknown')]);
    expect(skipped[0]?.reason).toBe("e0216-quoted-name-extract-failed");
  });

  it("e0216-unresolved-variant-type: the named type is not a union", () => {
    const store = writeAndLoad(["type N = Int", 'tile App = heading("hi")', ""].join("\n"));
    const { skipped } = planFixesExplained(store, [
      synth("E0216", 'Variant "Zork" is not a member of type "N"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0216-unresolved-variant-type");
  });

  it("e0216-no-close-tag: typo too far from every tag of the union", () => {
    const store = writeAndLoad(["type S = Idle | Busy", 'tile App = heading("hi")', ""].join("\n"));
    const { skipped } = planFixesExplained(store, [
      synth("E0216", 'Variant "ZZZZZZZZZZ" is not a member of type "S"'),
    ]);
    expect(skipped[0]?.reason).toBe("e0216-no-close-tag");
  });

  it("e0301-quoted-name-extract-failed: E0301 message without the `requires capability` phrase", () => {
    const store = writeAndLoad(
      [
        'tile App = heading("hi")',
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const { skipped } = planFixesExplained(store, [synth("E0301", "capability not declared")]);
    expect(skipped[0]?.reason).toBe("e0301-quoted-name-extract-failed");
  });

  it("e0301-no-app-def: no AppDef anywhere in the file", () => {
    // A file with no `app A ...` block: the E0301 handler can't find one to
    // append `caps` to. Skip surfaces the missing anchor.
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { skipped } = planFixesExplained(store, [
      synth("E0301", 'Effect "e" requires capability "log.write" which is not declared'),
    ]);
    expect(skipped[0]?.reason).toBe("e0301-no-app-def");
  });

  it("e0301-cap-already-present-or-no-caps-field: cap already listed in app.caps", () => {
    // `log.write` is already in the caps list → `appendAppCap` returns null →
    // patch is not offered, reason is recorded.
    const store = writeAndLoad(
      [
        'tile App = heading("hi")',
        "app A",
        "    caps   = [log.write]",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "",
      ].join("\n"),
    );
    const { skipped } = planFixesExplained(store, [
      synth("E0301", 'Effect "e" requires capability "log.write" which is not declared'),
    ]);
    expect(skipped[0]?.reason).toBe("e0301-cap-already-present-or-no-caps-field");
  });

  it("no-repair-branch: diagnostic code has no repair branch at all", () => {
    // E0999 is not among NAME_SUGGEST_CODES / E0106 / E0209 / E0301 / E0001,
    // so no branch fires. Distinct from `*-quoted-name-extract-failed`:
    // "we have no code path for this" rather than "the path we have couldn't
    // parse the message".
    const store = writeAndLoad('tile A = heading("hi")\n');
    const { patches, skipped } = planFixesExplained(store, [
      synth("E0999", "some future diagnostic"),
    ]);
    expect(patches).toEqual([]);
    expect(skipped[0]?.reason).toBe("no-repair-branch");
    expect(skipped[0]?.code).toBe("E0999");
  });
});

describe("planTestPatchExplained: skip-reason classification", () => {
  function writeAndLoad(source: string): { source: string; store: ReturnType<typeof load> } {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-tp-reason-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(file, source);
    const store = load(file);
    rmSync(dir, { recursive: true, force: true });
    return { source, store };
  }

  it("test-passes-or-no-leaf: pass=true short-circuits before any tier", () => {
    const result = planTestPatchExplained("", { name: "t", pass: true });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("test-passes-or-no-leaf");
  });

  it("leaf-equal-no-diff: leaf.actual === leaf.expected (nothing to change)", () => {
    const result = planTestPatchExplained("", {
      name: "t",
      pass: false,
      leaf: { actual: "same", expected: "same" },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("leaf-equal-no-diff");
  });

  it("leaf-not-a-kumiki-literal: NaN cannot be spelled as a numeric literal", () => {
    // `kumikiNumberLit(NaN)` returns null → the exact-literal tier bails with
    // `leaf-not-a-kumiki-literal`. Non-string leaf means Tier-2 skips; the
    // non-`slots.` diffAt means Tier-3 skips too — Tier-1's reason survives.
    const result = planTestPatchExplained('tile T = heading("a")\n', {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { actual: Number.NaN, expected: 5 },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("leaf-not-a-kumiki-literal");
  });

  it("no-scoped-literal-hit: boolean literal absent from source, no other tier runs", () => {
    // Boolean leaf means Tier-2 (string-partial) skips; non-`slots.` diffAt
    // means Tier-3 skips. `false` doesn't appear anywhere in the source, so
    // Tier-1 hits `no-scoped-literal-hit` and its reason surfaces to the caller.
    const result = planTestPatchExplained('tile T = heading("hi")\n', {
      name: "t",
      pass: false,
      diffAt: "heading.visible",
      leaf: { actual: false, expected: true },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("no-scoped-literal-hit");
  });

  it("affix-empty-middle: actual is a strict prefix of expected", () => {
    // affixDiff yields midA = "" when actual is fully consumed by pfx+sfx.
    // Tier-2 bails with `affix-empty-middle`. Tier-1 misses because "abc"
    // isn't a source literal (the tile spells "other").
    const result = planTestPatchExplained('tile T = heading("other")\n', {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { actual: "abc", expected: "abcd" },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("affix-empty-middle");
  });

  it("no-string-literal-contains-mida: no source literal contains the divergent middle", () => {
    const result = planTestPatchExplained('tile T = heading("hi")\n', {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { actual: "abc", expected: "axc" },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("no-string-literal-contains-mida");
  });

  it("patched-body-unspellable: patched body would contain a Kumiki-unspellable char", () => {
    // midA = "elx", midE = "\by". A unique source literal contains "elx",
    // but rebuilding it with `\b` produces a body `kumikiStringLit` refuses
    // to render → `patched-body-unspellable`. Tier-1 misses ("Helxo" is not
    // a source literal).
    const result = planTestPatchExplained('tile T = heading("prefix elx suffix")\n', {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { actual: "Helxo", expected: "H\byo" },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("patched-body-unspellable");
  });

  it("ambiguous-string-literal-match: partial-string tier can't disambiguate", () => {
    // Two independent literals share the same divergent middle "Helo" and
    // sit outside any target scope — partial tier has multiple equally-ranked
    // matches. Exact-literal tier passes through first (returns its own
    // reason), but Tier-2 dominates because it also ran.
    const { source, store } = writeAndLoad(
      ['tile A = heading("Helo, world")', 'tile B = label("Helo, world")', ""].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { actual: "Helo, chum", expected: "Hi, chum" },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("ambiguous-string-literal-match");
  });

  it("ambiguous-string-literal-match: two literals inside the target scope (rank 0 tie)", () => {
    // The existing sibling test has both hits OUTSIDE any scope (rank 2
    // tie). Here both hits sit INSIDE the target's own range (rank 0 tie):
    // two literals in tile A share the divergent middle from affixDiff
    // ("Helo, cats" vs "Hi, cats"). Tier-1 misses because "Helo, cats"
    // is not spelled anywhere.
    const { source, store } = writeAndLoad(
      [
        'tile A = column(heading("Helo, world"), label("Helo, chum"))',
        "test t =",
        "    tile-test A",
        "        given  = {slots: {}}",
        '        expect = column(heading("Hi, cats"), label("Helo, chum"))',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { actual: "Helo, cats", expected: "Hi, cats" },
      },
      [[2, 5]],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("ambiguous-string-literal-match");
  });

  it("ambiguous-string-literal-match: two literals resolve to the same decoded body via escapes", () => {
    // Two literals `"a\nb"` and `"a\nb"` — the raw source is identical but so
    // is the decoded body (`a` + real newline + `b`). Both must be surfaced as
    // candidates in decoded space and produce an ambiguity bail, not a
    // silent-mismatch that skips both.
    const { source, store } = writeAndLoad(
      ['tile A = heading("a\\nb suffix")', 'tile B = label("a\\nb suffix")', ""].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { actual: "a\nb suffix", expected: "a\nb replaced" },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("ambiguous-string-literal-match");
  });

  it("patched-body-unspellable: source contains an escape, midE would carry a control char", () => {
    // Regression guard for the escape round-trip: even with escape-normalized
    // matching, an unspellable `midE` must still bail via
    // `patched-body-unspellable` and not silently ship a corrupt literal.
    const result = planTestPatchExplained('tile T = heading("pre \\nX suffix")\n', {
      name: "t",
      pass: false,
      diffAt: "heading.text",
      leaf: { actual: "pre \nX suffix", expected: "pre \nX\bsuffix" },
    });
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("patched-body-unspellable");
  });

  it("ambiguous-string-literal-match: two literals inside deps of the target (rank 1 tie)", () => {
    // Third rank tier: both hits sit in tiles the target depends on but
    // not in the target itself. Completes rank 0 / 1 / 2 tie coverage.
    // The target tile Root composes TileL and TileR (deps); both deps
    // hold the divergent middle.
    const { source, store } = writeAndLoad(
      [
        'tile TileL = heading("Helo, world")',
        'tile TileR = label("Helo, chum")',
        "tile Root = column(TileL, TileR)",
        "test t =",
        "    tile-test Root",
        "        given  = {slots: {}}",
        '        expect = column(heading("Hi, cats"), label("Helo, chum"))',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "heading.text",
        leaf: { actual: "Helo, cats", expected: "Hi, cats" },
      },
      [[4, 7]],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("ambiguous-string-literal-match");
  });

  it("ambiguous-reducer-set: two reducers write the same slot", () => {
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        "reducer dec on=ui.click(C) do= count := count - 1",
        'tile B = button(text="+")',
        'tile C = button(text="-")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 99, expected: 100 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("ambiguous-reducer-set");
  });

  it("no-additive-multiplicative-shape: reducer body lacks the `slot := slot ± N` shape", () => {
    // Reducer body is `count := count` — no operator. Tier-1 misses because
    // `99` (actual) never appears in source outside the excluded fixture, so
    // Tier-3 fires and reports the shape-mismatch instead.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer set on=ui.click(B) do= count := count",
        'tile B = button(text="set")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 99, expected: 7 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("no-additive-multiplicative-shape");
  });

  it("additive-zero-delta: expected equals the base (before the reducer applied delta)", () => {
    // Reducer: count += 1 → actual=6 means base was 5. expected=5 means the
    // wanted delta is 0, which is the identity — no arithmetic can express
    // it as `slot := slot + N` or `slot := slot - N`.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        'tile B = button(text="+")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 6, expected: 5 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("additive-zero-delta");
  });

  // `additive-noop-solution`, `arithmetic-splice-target-lost`, and
  // `internal-body-not-found` are defensive branches: the algebra of
  // `planArithmeticPatchExplained` (and the regex invariants of the string
  // planner) makes them unreachable from the top-level API. Each is a guard
  // for a state that would indicate a bug in an earlier step, not a real
  // failure mode a caller can trip. They're kept as `debugSkip` sites so a
  // future refactor that does hit them lights up under `KUMIKI_DEBUG=fix`.
  // `non-safe-integer-operand` is intentionally excluded — the lexer accepts
  // arbitrary-length digit sequences, so a pathological source operand
  // exceeding `Number.MAX_SAFE_INTEGER` reaches that guard through the
  // top-level API; the dedicated reachability test below covers it.

  it("multiplicative-zero-guard: actual value is zero (base cannot be recovered)", () => {
    // Reducer `count * 3` with given count=0 → actual = 0. `0` is absent from
    // the source (slot init is 5, reducer body uses 3), so Tier-1 misses.
    // Tier-3 arithmetic runs on n=3 with actual=0 → hits the zero-guard.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 5",
        "reducer mul on=ui.click(B) do= count := count * 3",
        'tile B = button(text="mul")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 0, expected: 7 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("multiplicative-zero-guard");
  });

  it("multiplicative-nonintegral-base: actual/n is not integral", () => {
    // Reducer: count := count * 2. actual = 5 (odd) means base = 5/2 = 2.5,
    // not integral — the tier cannot reconstruct the base and bails.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 1",
        "reducer dbl on=ui.click(B) do= count := count * 2",
        'tile B = button(text="dbl")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 5, expected: 6 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("multiplicative-nonintegral-base");
  });

  it("multiplicative-nonintegral-solution: expected/base is not integral", () => {
    // Reducer: count := count * 2. actual=4 → base=2. expected=5 → newN=2.5,
    // not integral — bail.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 1",
        "reducer dbl on=ui.click(B) do= count := count * 2",
        'tile B = button(text="dbl")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 4, expected: 5 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("multiplicative-nonintegral-solution");
  });

  it("multiplicative-zero-guard: reducer operand is zero (n === 0 side)", () => {
    // Complement to the actual===0 test above — exercises the `n === 0`
    // side of the same OR. Reducer `count := count * 0`; actual=17 is
    // absent from source, so Tier-1 misses and Tier-3 runs.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 9",
        "reducer noop on=ui.click(B) do= count := count * 0",
        'tile B = button(text="noop")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 17, expected: 4 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("multiplicative-zero-guard");
  });

  it("multiplicative-nonintegral-solution: differently-shaped reducer", () => {
    // Distinct instance of the same bail so a future refactor that only
    // re-covers one arithmetic (e.g. narrows the regex) still trips this
    // one. Reducer `count := count * 3`, actual=6 → base=2, expected=7 →
    // newN=3.5 → bail.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 1",
        "reducer tpl on=ui.click(B) do= count := count * 3",
        'tile B = button(text="tpl")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 6, expected: 7 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("multiplicative-nonintegral-solution");
  });

  it("non-safe-integer-operand: reducer operand exceeds Number.MAX_SAFE_INTEGER", () => {
    // Reachability proof for the `Number.isSafeInteger(n)` guard: the lexer
    // accepts arbitrary-length digit sequences and `stmtRe` is `-?\d+`, so a
    // 20-digit operand parses fine but `Number.parseInt` returns a non-safe
    // integer. Without the guard, the subsequent algebra (`actual - delta`,
    // `expected - base`) would silently round and produce a bad splice.
    const { source, store } = writeAndLoad(
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 99999999999999999999",
        'tile B = button(text="inc")',
        "",
      ].join("\n"),
    );
    const result = planTestPatchExplained(
      source,
      {
        name: "t",
        pass: false,
        diffAt: "slots.count",
        leaf: { actual: 42, expected: 1 },
      },
      [],
      store,
    );
    expect(result.patch).toBeNull();
    if (result.patch === null) expect(result.reason).toBe("non-safe-integer-operand");
  });
});

describe("FixFromTestOutcome.reason propagation and printer", () => {
  it("runFixFromTest: Tier-1 lands both repairs when one line holds two", async () => {
    // The tier-1 loop composes the same plan `applyFixPlan` does, and writes
    // without a regression gate — so a repair that moved another's column
    // failed silently here instead of rolling back.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-tier1-two-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot seen : Bool = false",
        "reducer clicked on=ui.click(B) do= seen := $route.path == $route.pattern",
        'tile B = button(text="go")',
        "tile App = column(B)",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test clicked",
        "        given  = {slots: {seen: false}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {seen: true}}",
        "",
      ].join("\n"),
    );
    const outcome = await runFixFromTest(file, "t", true);
    // Both, not one: a plan that lands half its patches leaves the file still
    // holding the diagnostic it reported as repaired.
    expect(outcome.compileFixes).toBe(2);
    expect(readFileSync(file, "utf8")).toContain("seen := route.path == route.pattern");
    rmSync(dir, { recursive: true, force: true });
  });

  it("runFixFromTest: Tier-2 no-patch surfaces the tier planner's reason", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-outcome-reason-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        // Multiplicative-nonintegral-solution scenario: `count := count * 2`
        // with expected=5 (odd) means the arithmetic tier can't solve.
        "slot count : Int = 1",
        "reducer dbl on=ui.click(B) do= count := count * 2",
        'tile B = button(text="dbl")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test dbl",
        "        given  = {slots: {count: 2}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 5}}",
        "",
      ].join("\n"),
    );
    const outcome = await runFixFromTest(file, "t", false);
    expect(outcome.status).toBe("no-patch");
    if (outcome.status === "no-patch") {
      // reason is one of the multiplicative arms — pin the family, not the
      // exact arm, so the classifier can be refined without breaking this
      // test. The concrete arm here is `multiplicative-nonintegral-solution`.
      expect(outcome.reason).toMatch(/^multiplicative-/);
      expect(outcome.failingTest).toBeDefined();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("runFixFromTest: compile-tier no-patch propagates the first skip reason end-to-end", async () => {
    // E0301 fires (effect requires capability `log.write`) but there is no
    // `app` def in the file, so `planFixesExplained` records
    // `e0301-no-app-def` and returns zero patches. `runFixFromTest` must
    // surface that reason into the outcome, and `printFixFromTest` must
    // print it above the compile errors. E0003 fires on the same file and is
    // appended after, which is what keeps the specific reason first.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-compile-reason-e2e-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        'tile App = heading("hi")',
        "",
      ].join("\n"),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await fixFromTest(file, "t", false);
      expect(outcome.status).toBe("no-patch");
      if (outcome.status === "no-patch") {
        expect(outcome.compileErrors?.some((e) => e.code === "E0301")).toBe(true);
        expect(outcome.compileErrors?.some((e) => e.code === "E0003")).toBe(true);
        expect(outcome.reason).toBe("e0301-no-app-def");
      }
      const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stdout).toMatch(/reason: e0301-no-app-def/);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runFixFromTest: testRunError variant carries reason=test-runner-threw and printer surfaces it", async () => {
    // The branch under test is what `runFixFromTest` does when the test module
    // throws instead of reporting. Reaching it through a *program* means
    // relying on something the checker does not catch — this test used to use
    // an unbound identifier in a test body, which is E0103 now, and the next
    // candidate (a tile-test that omits the `in` its tile declares) is itself
    // filed as a gap. So the throw comes from the runner rather than from a
    // program, and no future check can take it away.
    const dir = mkdtempSync(join(tmpdir(), "kumiki-runner-throw-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        'tile B = button(text="+")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test inc",
        "        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 1}}",
        "",
      ].join("\n"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("../src/smoke.ts", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/smoke.ts")>()),
      testFile: () => {
        throw new Error("the generated module threw");
      },
    }));
    try {
      const { fixFromTest: withThrowingRunner } = await import("../src/fix.ts");
      const outcome = await withThrowingRunner(file, "t", false);
      expect(outcome.status).toBe("no-patch");
      if (outcome.status === "no-patch") {
        expect(outcome.testRunError).toBeDefined();
        expect(outcome.reason).toBe("test-runner-threw");
      }
      const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderr).toContain("could not run tests");
      expect(stderr).toMatch(/reason:\s+test-runner-threw/);
    } finally {
      vi.doUnmock("../src/smoke.ts");
      vi.resetModules();
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("printFixFromTest: write-failed / phase=test prints `could not write test patch` on stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-print-writefail-test-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 0",
        "reducer dec on=ui.click(B) do= count := count + 1",
        'tile B = button(text="-")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test dec",
        "        given  = {slots: {count: 5}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 4}}",
        "",
      ].join("\n"),
    );
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("EBUSY: simulated");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await fixFromTest(file, "t", true);
      expect(outcome.status).toBe("write-failed");
      const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderr).toContain('could not write test patch for "t"');
      expect(stderr).toContain("EBUSY");
    } finally {
      writeSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("printFixFromTest: write-failed / phase=compile suppresses the `applied N compile fix(es)` header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-print-writefail-compile-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "effect logHello cap=log.write",
        "                in=Text",
        "                out=Unit",
        "",
        'reducer greet on=app.start do= emit logHello("hi")',
        "slot count : Int = 0",
        "reducer inc on=ui.click(B) do= count := count + 1",
        'tile B = button(text="+")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test inc",
        "        given  = {slots: {count: 0}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 1}}",
        "",
      ].join("\n"),
    );
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("ENOSPC: simulated");
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await fixFromTest(file, "t", true);
      const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      // The compile-fix header would lie: no fix landed on disk. Must be absent.
      expect(stdout).not.toMatch(/applied \d+ compile fix\(es\)/);
      const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(stderr).toContain('could not write compile fix for "t"');
      expect(stderr).toContain("ENOSPC");
    } finally {
      writeSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("printFixFromTest: emits `reason:` line when outcome carries one (failing-test branch)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-print-reason-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(
      file,
      [
        "slot count : Int = 1",
        "reducer dbl on=ui.click(B) do= count := count * 2",
        'tile B = button(text="dbl")',
        "tile App = column(B, text(count.show))",
        "app A",
        "    caps   = []",
        '    routes = {"/" -> App, "/404" -> App}',
        "    init   = []",
        "test t =",
        "    reducer-test dbl",
        "        given  = {slots: {count: 2}, event: {type: ui.click, target: B}}",
        "        expect = {slots: {count: 5}}",
        "",
      ].join("\n"),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await fixFromTest(file, "t", false);
      const joined = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(joined).toMatch(/reason:\s+multiplicative-/);
    } finally {
      logSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("KUMIKI_DEBUG=fix hook", () => {
  function withEnv<T>(value: string | undefined, body: () => T): T {
    const prev = process.env.KUMIKI_DEBUG;
    if (value === undefined) delete process.env.KUMIKI_DEBUG;
    else process.env.KUMIKI_DEBUG = value;
    try {
      return body();
    } finally {
      if (prev === undefined) delete process.env.KUMIKI_DEBUG;
      else process.env.KUMIKI_DEBUG = prev;
    }
  }

  const store = () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-debug-hook-"));
    const file = join(dir, "in.kumiki");
    writeFileSync(file, 'tile A = heading("hi")\n');
    const s = load(file);
    rmSync(dir, { recursive: true, force: true });
    return s;
  };

  const noQuotedNameErr = {
    code: "E0102",
    kind: "type-error" as const,
    message: "no quoted name here",
    pos: { line: 1, col: 1 },
  };

  it("emits console.warn when KUMIKI_DEBUG=fix is set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv("fix", () => planFixesExplained(store(), [noQuotedNameErr]));
      const joined = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(joined).toContain("[kumiki fix] skip");
      expect(joined).toContain("quoted-name-extract-failed");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is silent when KUMIKI_DEBUG is unset", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv(undefined, () => planFixesExplained(store(), [noQuotedNameErr]));
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is silent when KUMIKI_DEBUG names a different scope", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv("smoke", () => planFixesExplained(store(), [noQuotedNameErr]));
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is active when KUMIKI_DEBUG is a comma-separated list containing `fix`", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv("smoke,fix", () => planFixesExplained(store(), [noQuotedNameErr]));
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is silent when KUMIKI_DEBUG is empty or whitespace-only", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv("", () => planFixesExplained(store(), [noQuotedNameErr]));
      withEnv("   ", () => planFixesExplained(store(), [noQuotedNameErr]));
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is silent when KUMIKI_DEBUG names a scope that shares a prefix with `fix`", () => {
    // Exact-token match — `fix-verbose` must NOT trigger the `fix` scope.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv("fix-verbose", () => planFixesExplained(store(), [noQuotedNameErr]));
      withEnv("prefix-of-fix", () => planFixesExplained(store(), [noQuotedNameErr]));
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("tolerates whitespace around comma-separated scope names", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withEnv("  smoke ,  fix  ", () => planFixesExplained(store(), [noQuotedNameErr]));
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// Reference resolution used to be a name match over the source text, so a
// record field, a word in a comment, a string literal and a loop variable all
// counted as references to a definition that merely shared their spelling.
// `rename` rewrote every one of them; `remove --cascade` followed them; `refs`
// and `view --with-deps` disagreed because only one of the two stripped strings.
describe("references resolve through the AST, not the source text", () => {
  // `label` is a slot AND a record field AND a word in a comment. Only the slot
  // and its one real reference may move.
  const AMBIGUOUS = `type ItemId = nominal Text where len-eq(3)
type Item   = {id: ItemId, label: Text}

# a counter whose label says count
slot label : Text = "hi"
slot count : Int  = 0

reducer bump on=ui.click(Btn) do= count := count + 1

tile Btn = button(text="label", onClick=bump)
tile App = column(Btn, text(label))

app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  function write(src: string): string {
    const dir = mkdtempSync(join(tmpdir(), "kumiki-refs-"));
    const dst = join(dir, "input.kumiki");
    writeFileSync(dst, src);
    return dst;
  }

  it("renames a slot without touching a record field of the same name", () => {
    const f = write(AMBIGUOUS);
    renameDef(f, "slot.label", "caption");
    const out = readFileSync(f, "utf8");
    expect(out).toContain("type Item   = {id: ItemId, label: Text}");
    expect(out).toContain("slot caption : Text");
    expect(out).toContain("text(caption)");
  });

  it("leaves the name alone inside a comment and a string literal", () => {
    const f = write(AMBIGUOUS);
    renameDef(f, "slot.label", "caption");
    const out = readFileSync(f, "utf8");
    expect(out).toContain("# a counter whose label says count");
    expect(out).toContain('button(text="label"');
  });

  it("refuses a rename that would collide with an existing definition", () => {
    const f = write(AMBIGUOUS);
    expect(() => renameDef(f, "slot.label", "count")).toThrow(/already exists/);
    expect(readFileSync(f, "utf8")).toBe(AMBIGUOUS);
  });

  it("does not count a definition as a reference to itself", () => {
    const store = load(COUNTER);
    for (const e of listDefs(store)) {
      const q = `${e.layer}.${e.name}`;
      expect(findReferences(store, q).map((r) => r.qname)).not.toContain(q);
    }
  });

  // `refs` and `view --with-deps` read the same edge from opposite ends. They
  // used to disagree: `findReferences` stripped strings before matching and
  // `directDeps` did not, so a name inside a string literal was a dependency in
  // one direction and not a reference in the other — and the op log's
  // `depends-on` recorded the looser of the two.
  //
  // Comparing the two APIs to each other would prove nothing now: they read one
  // shared table, so the comparison is an identity. The edges are pinned
  // literally instead, which is what would actually go red if the walk changed.
  it("reports the edges of a known file exactly, in both directions", () => {
    const store = load(COUNTER);
    expect(directDeps(store, "app.Counter")).toEqual(["tile.App"]);
    expect(directDeps(store, "tile.App")).toEqual([
      "slot.count",
      "tile.DecBtn",
      "tile.IncBtn",
      "tile.ResetBtn",
    ]);
    expect(directDeps(store, "slot.count")).toEqual(["type.N"]);
    expect(directDeps(store, "type.N")).toEqual([]);

    expect(
      findReferences(store, "slot.count")
        .map((r) => r.qname)
        .sort(),
    ).toEqual(["reducer.dec", "reducer.inc", "reducer.reset", "tile.App"]);
    expect(findReferences(store, "type.N").map((r) => r.qname)).toEqual(["slot.count"]);
    // `IncBtn` is named by its reducer's selector and by `tile App` — the
    // selector edge is the one the AST used to drop.
    expect(
      findReferences(store, "tile.IncBtn")
        .map((r) => r.qname)
        .sort(),
    ).toEqual(["reducer.inc", "tile.App"]);
  });

  it("keeps a definition out of its own reference list even when it recurses", () => {
    const f = write(`slot depth : Int = 0
fn countdown(n: Int) -> Int = if n <= 0 then 0 else countdown(n - 1)
tile Node = column(text(depth.show), Node)
tile App = column(Node, text(countdown(depth).show))

app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const store = load(f);
    expect(directDeps(store, "fn.countdown")).toEqual([]);
    expect(directDeps(store, "tile.Node")).toEqual(["slot.depth"]);
    expect(findReferences(store, "tile.Node").map((r) => r.qname)).toEqual(["tile.App"]);
  });

  it("cascade removal reports every definition it deletes, as one op", () => {
    const f = copy(COUNTER);
    const { removed } = removeDef(f, "slot.count", true);
    // `count` is read by all three reducers and by `tile App`, and `App` is the
    // only route target, so `app Counter` goes with it. The three buttons are
    // referenced BY the reducers, not the other way round, so they survive.
    // The requested definition comes first — a replay applies it as the head of
    // the bundle — so compare the set, then pin the head separately.
    expect(removed[0]).toBe("slot.count");
    expect([...removed].sort()).toEqual([
      "app.Counter",
      "reducer.dec",
      "reducer.inc",
      "reducer.reset",
      "slot.count",
      "tile.App",
    ]);
    const after = load(f);
    expect(
      listDefs(after)
        .map((e) => `${e.layer}.${e.name}`)
        .sort(),
    ).toEqual(["tile.DecBtn", "tile.IncBtn", "tile.ResetBtn", "type.N"]);
    const log = readOpLog(f);
    expect(log).toHaveLength(1);
    expect(log[0]?.removed).toEqual(removed);
    expect(log[0]?.cascade).toBe(true);
  });
});
