import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDef,
  applyFixPlan,
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
import { check, collectTimerNames, variantTagsOf } from "@kumikijs/compiler";
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
        "        given  = {slots: {count: 0}, event: {kind: click, tile: B, id: none}}",
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
        "        given  = {slots: {flag: false}, event: {kind: click, tile: B, id: none}}",
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
        "        given  = {slots: {flag: true}, event: {kind: click, tile: B, id: none}}",
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
        "        given  = {slots: {count: 0}, event: {kind: click, tile: DecBtn, id: none}}",
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
        "        given  = {slots: {count: 5}, event: {kind: click, tile: B, id: none}}",
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
