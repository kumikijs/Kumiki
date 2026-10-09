import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import type { AppShape } from "@kumikijs/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import { scratchRoot } from "./helpers/scratch.ts";

// A reducer's `[…]` step reaches the runtime's setter as `{at: key}`, apart
// from a field step (language.md §1.6.3): the two are both a string once
// evaluated, and only the encoding tells the setter that a missing Map entry
// is one `m[k].f := v` writes nothing through, where a missing record field is
// a level to build. The runtime's half is pinned in `set-path.test.ts`; this is
// the compiler's half — what `genSlotAssign` writes — and the two run together.

const SRC = `type Todo = { title: Text, done: Bool }
type Cell = { n: Int }

slot todos : Map(Text, Todo) = {}
slot grid  : Map(Text, Map(Text, Cell)) = {}
slot opts  : Map(Text, Option(Todo)) = {}
slot sel   : Text = "t1"

reducer mark    on=ui.click(Mark)    do= todos[sel].done := true
reducer put     on=ui.click(Put)     do= todos[sel] := {title: "x", done: false}
reducer cell-n  on=ui.click(CellN)   do= grid["a"]["b"].n := 1
reducer cell    on=ui.click(CellPut) do= grid["a"]["b"] := {n: 2}
reducer opt     on=ui.click(Opt)     do= opts["a"].get.done := true

tile Mark    = button(text="m")
tile Put     = button(text="p")
tile CellN   = button(text="cn")
tile CellPut = button(text="cp")
tile Opt     = button(text="o")
tile App = column(Mark, Put, CellN, CellPut, Opt)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const TMP_ROOT = scratchRoot(import.meta.url);

/** The generated module, mounting nothing (`exportApp`), or the reason it failed. */
function jsOf(exportApp: boolean): string {
  const result = compile(SRC, { runtimeSpecifier: "@kumikijs/runtime", exportApp });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result));
  return result.js;
}

async function load(js: string): Promise<AppShape> {
  const dir = mkdtempSync(join(TMP_ROOT, "index-step-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, js);
  const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as {
    default: AppShape;
  };
  return mod.default;
}

/** The slot writes of one run of reducer `name` against `live`. */
function run(app: AppShape, name: string, live: Record<string, unknown>): Record<string, unknown> {
  Object.assign(app.live as Record<string, unknown>, live);
  const reducer = app.reducers.find((r) => r.name === name);
  if (!reducer) throw new Error(`no reducer ${name}`);
  return reducer.apply({}, {}).slots;
}

describe("genSlotAssign encodes an index step as {at: key}", () => {
  const js = jsOf(false);

  it("checks clean", () => {
    expect(check(parse(lex(SRC)))).toEqual([]);
  });

  it("wraps each `[…]` key and leaves field and `.get` steps as they were", () => {
    const sel = '(Object.hasOwn(_next, "sel") ? _next["sel"] : _live["sel"])';
    expect(js).toContain(`[{ at: ${sel} }, "done"], true)`);
    expect(js).toContain(`[{ at: ${sel} }], {`);
    expect(js).toContain('[{ at: "a" }, { at: "b" }, "n"], 1)');
    expect(js).toContain('[{ at: "a" }, { at: "b" }], {');
    expect(js).toContain('[{ at: "a" }, {"get":true}, "done"], true)');
  });
});

describe("the emitted write, run", () => {
  let appP: Promise<AppShape>;
  beforeAll(() => {
    appP = load(jsOf(true));
  });
  const todo = { title: "a", done: false };

  it("writes a field of the entry at a held key, and nothing at an absent one", async () => {
    const app = await appP;
    expect(run(app, "mark", { sel: "t1", todos: { t1: todo } }).todos).toEqual({
      t1: { title: "a", done: true },
    });
    expect(run(app, "mark", { sel: "t9", todos: { t1: todo } }).todos).toEqual({ t1: todo });
  });

  // An absent Map slot — `undefined` after a restore or a decode that found
  // nothing — is read as the empty Map (`?? {}` around the slot read), so the
  // two writes do what they do on `{}`: the field write finds no entry and
  // leaves an empty Map, the entry write inserts.
  it("reads an absent Map slot as the empty Map", async () => {
    const app = await appP;
    expect(run(app, "mark", { sel: "t1", todos: undefined }).todos).toEqual({});
    expect(run(app, "put", { sel: "t1", todos: undefined }).todos).toEqual({
      t1: { title: "x", done: false },
    });
  });

  it("writes nothing through an absent outer key of a nested Map", async () => {
    const app = await appP;
    expect(run(app, "cell-n", { grid: {} }).grid).toEqual({});
    expect(run(app, "cell", { grid: {} }).grid).toEqual({});
    expect(run(app, "cell", { grid: { a: {} } }).grid).toEqual({ a: { b: { n: 2 } } });
  });

  it("writes through `.get` of a held entry, and nothing at an absent key", async () => {
    const app = await appP;
    expect(run(app, "opt", { opts: { a: { _tag: "Some", _0: todo } } }).opts).toEqual({
      a: { _tag: "Some", _0: { title: "a", done: true } },
    });
    expect(run(app, "opt", { opts: {} }).opts).toEqual({});
  });
});
