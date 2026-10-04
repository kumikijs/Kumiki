// A body is a definition without its `<layer> <name>` opener. A tile's clauses
// and a type's parameters sit between the name and the `=`, so a body can
// state them, and a `replace` body that does not keeps the ones the
// definition has. Every body the op log records — from `add`, `replace`,
// `edit` and `remove` — writes its definition back whole, which is what
// `patch revert` restores from.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDef,
  editDef,
  LAYERS,
  load,
  patchRevert,
  readOpLog,
  removeDef,
  replaceDef,
  viewDef,
} from "@kumikijs/cli";
import type { TileDef } from "@kumikijs/compiler";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_ARGV } from "./helpers/cli.ts";
import { defined } from "./helpers/defined.ts";

let dir = "";
const seed = (source: string): string => {
  dir = mkdtempSync(join(tmpdir(), "kumiki-def-header-"));
  const file = join(dir, "h.kumiki");
  writeFileSync(file, source);
  return file;
};
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const logPath = (file: string): string => `${file}.kumiki-ops.jsonl`;
const lastOp = (file: string) => defined(readOpLog(file).at(-1), "an op in the log");
const textOf = (file: string, qname: string): string =>
  defined(viewDef(load(file), qname), `the definition ${qname}`);

const APP = `app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** The program from the issue: a tile with an `error-boundary=` clause. */
const BOUNDARY = `slot name : Text = "Ada"

tile Oops = text("boom")
tile Other = text("bang")
tile Greeting error-boundary=Oops = heading("Hi, " + name)
tile App = column(Greeting)

${APP}`;

/** A tile whose `in=` clause types the `$1` its body reads. */
const INPUT = `slot name : Text = "Ada"

tile Greeting in=Text = heading("Hi, " + $1)
tile App = column(Greeting(name))

${APP}`;

/** A `sub-routes` parent laid out over several lines, as the examples write one. */
const NESTED = `tile AccountSettings = page(heading("Account settings"))
tile SettingsHome    = page(heading("Settings home"))

tile SettingsLayout
    sub-routes = {
        "/settings/account" -> AccountSettings,
        "/settings"         -> SettingsHome
    }
    = page(heading("Settings"), route-outlet())

tile App = page(heading("Landing"))

app NestedRoutes
    caps   = [nav.push]
    routes = {"/" -> App, "/settings/*" -> SettingsLayout, "/404" -> App}
    init   = []
`;

/** A generic type, applied to one argument where it is used. */
const GENERIC = `type Box(T) = {v: T}

slot box : Option(Box(Int)) = None
`;

describe("replace keeps the clauses and parameters its body does not state", () => {
  it("keeps a tile's error-boundary", () => {
    const file = seed(BOUNDARY);

    replaceDef(file, "tile.Greeting", 'heading("Hello, " + name)');

    expect(textOf(file, "tile.Greeting")).toBe(
      'tile Greeting error-boundary=Oops = heading("Hello, " + name)',
    );
    // Logged whole, so a later revert to this op's state puts the clause back.
    expect(lastOp(file).body).toBe('error-boundary=Oops = heading("Hello, " + name)');
  });

  it("keeps a tile's sub-routes block written over several lines", () => {
    const file = seed(NESTED);

    replaceDef(file, "tile.SettingsLayout", 'page(heading("Prefs"), route-outlet())');

    const def = defined(load(file).byQName.get("tile.SettingsLayout"), "tile.SettingsLayout")
      .def as TileDef;
    expect(def.subRoutes?.map((r) => `${r.path} -> ${r.tile}`)).toEqual([
      "/settings/account -> AccountSettings",
      "/settings -> SettingsHome",
    ]);
    expect(textOf(file, "tile.SettingsLayout")).toContain(
      '    }\n    = page(heading("Prefs"), route-outlet())',
    );
  });

  it("keeps a type's parameters", () => {
    const file = seed(GENERIC);

    replaceDef(file, "type.Box", "{v: T, n: Int}");

    expect(textOf(file, "type.Box")).toBe("type Box(T) = {v: T, n: Int}");
  });

  it("replaces the clauses with the ones a body states", () => {
    const file = seed(BOUNDARY);

    replaceDef(file, "tile.Greeting", 'error-boundary=Other = heading("Hello")');

    expect(textOf(file, "tile.Greeting")).toBe(
      'tile Greeting error-boundary=Other = heading("Hello")',
    );
  });

  it("drops the clauses when the body starts at the `=`", () => {
    const file = seed(BOUNDARY);

    replaceDef(file, "tile.Greeting", '= heading("Hello")');

    expect(textOf(file, "tile.Greeting")).toBe('tile Greeting = heading("Hello")');
  });
});

describe("add writes the clauses and parameters a body states", () => {
  it("adds a tile with an in= clause, logged under its own name", () => {
    const file = seed(INPUT);

    addDef(file, "tile", "Greet", "in=Text = heading($1)");

    expect(textOf(file, "tile.Greet")).toBe("tile Greet in=Text = heading($1)");
    const op = lastOp(file);
    expect([op.op, op.layer, op.name, op.body]).toEqual([
      "add",
      "tile",
      "Greet",
      "in=Text = heading($1)",
    ]);
  });

  it("adds a generic type, logged under its own name", () => {
    const file = seed("slot n : Int = 0\n");

    addDef(file, "type", "Box", "(T) = {v: T}");

    expect(textOf(file, "type.Box")).toBe("type Box(T) = {v: T}");
    const op = lastOp(file);
    expect([op.layer, op.name, op.body]).toEqual(["type", "Box", "(T) = {v: T}"]);
  });

  it("refuses a name that is not one identifier, writing nothing", () => {
    // The parameters smuggled into the name used to be written, and the op was
    // logged as `type.Box(T)` — a name nothing can view, revert or remove.
    const file = seed("slot n : Int = 0\n");

    expect(() => addDef(file, "type", "Box(T)", "{v: T}")).toThrowError(/"Box\(T\)"/);

    expect(readFileSync(file, "utf8")).toBe("slot n : Int = 0\n");
    expect(existsSync(logPath(file))).toBe(false);
  });
});

describe("patch revert of an edit to a definition with clauses", () => {
  it("restores the body the previous edit left, clauses included", () => {
    const file = seed(INPUT);
    editDef(file, "tile.Greeting", { find: "Hi, ", replace: "Hello, " });
    const second = editDef(file, "tile.Greeting", { find: "Hello, ", replace: "Hey, " });

    patchRevert(file, second);

    expect(textOf(file, "tile.Greeting")).toBe('tile Greeting in=Text = heading("Hello, " + $1)');
  });

  it("restores a tile that had no clauses before a replace gave it one", () => {
    // The restored body states no clauses because the tile had none, so the
    // clause the reverted replace added must not be kept.
    const file = seed(BOUNDARY);
    addDef(file, "tile", "Plain", 'heading("Hi")');
    const replaced = replaceDef(file, "tile.Plain", 'error-boundary=Oops = heading("Hi")');

    patchRevert(file, replaced);

    expect(textOf(file, "tile.Plain")).toBe('tile Plain = heading("Hi")');
  });
});

/**
 * One definition of each kind, written through `add`. Every label the store
 * puts on a definition has a row, so a new kind of definition that `add` cannot
 * write, or `remove` cannot read back, fails here.
 */
const KINDS: { layer: string; name: string; body: string }[] = [
  { layer: "type", name: "Point", body: "{x: Int, y: Int}" },
  { layer: "type", name: "Pair", body: "(A, B) = {first: A, second: B}" },
  { layer: "slot", name: "m", body: "Int = 1" },
  { layer: "effect", name: "save", body: "cap=storage.write in=Int out=Result(Unit, Text)" },
  { layer: "reducer", name: "reset", body: "on=ui.click(ResetBtn) do= n := 0" },
  { layer: "tile", name: "Plain", body: 'text("a")' },
  { layer: "tile", name: "Greet", body: "in=Text = heading($1)" },
  { layer: "tile", name: "Guarded", body: 'error-boundary=Oops = text("b")' },
  { layer: "tile", name: "Laid", body: "in=Text\n    error-boundary=Oops\n    = heading($1)" },
  { layer: "fn", name: "inc", body: "(x: Int) -> Int = $1 + 1" },
  {
    layer: "app",
    name: "Main",
    body: '    caps   = []\n    routes = {"/" -> Btn, "/404" -> Btn}\n    init   = []',
  },
  { layer: "theme", name: "Light", body: '{colors: {bg: "#ffffff", fg: "#1a1a1a"}}' },
  {
    layer: "motion",
    name: "Fade",
    body: '{keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: "normal"}',
  },
  {
    layer: "test",
    name: "bump-adds-one",
    body: "reducer-test bump given = {slots: {n: 0}, event: {type: ui.click, target: Btn}} expect = {slots: {n: 1}}",
  },
];

const KIND_BASE = `slot n : Int = 0

tile Oops = text("boom")
tile Btn = button(text="+")
tile ResetBtn = button(text="0")

reducer bump on=ui.click(Btn) do= n := n + 1
`;

describe("every kind of definition", () => {
  it("has a row for every label the store puts on a definition", () => {
    expect([...new Set(KINDS.map((k) => k.layer))].sort()).toEqual([...LAYERS].sort());
  });

  it.each(KINDS)("$layer $name: remove records the body add was given, and revert restores it", ({
    layer,
    name,
    body,
  }) => {
    const file = seed(KIND_BASE);
    const qname = `${layer}.${name}`;
    addDef(file, layer, name, body);
    const added = textOf(file, qname);

    const { opId } = removeDef(file, qname, false);
    expect(lastOp(file).bodies?.[0]?.body).toBe(body);

    patchRevert(file, opId);
    expect(textOf(file, qname)).toBe(added);
  });

  it("replaces a test", () => {
    const file = seed(
      `${KIND_BASE}\ntest bump-adds-one =\n    reducer-test bump\n        given  = {slots: {n: 0}, event: {type: ui.click, target: Btn}}\n        expect = {slots: {n: 1}}\n`,
    );
    const body =
      "reducer-test bump given = {slots: {n: 5}, event: {type: ui.click, target: Btn}} expect = {slots: {n: 6}}";

    replaceDef(file, "test.bump-adds-one", body);

    expect(textOf(file, "test.bump-adds-one")).toBe(`test bump-adds-one = ${body}`);
  });
});

describe("kumiki add, the command", () => {
  // Each case pays for a node + tsx start, so the limits allow for a loaded
  // machine; the child's is the shorter one so it always fires first.
  const SPAWN = { timeout: 70_000 };
  const run = (args: string[]): { stderr: string; code: number } => {
    const res = spawnSync(process.execPath, [...CLI_ARGV, ...args], {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 60_000,
    });
    if (res.error) throw res.error;
    return { stderr: res.stderr ?? "", code: res.status ?? Number.NaN };
  };

  it("rejects a layer that labels no definition with 2, before reading the file", SPAWN, () => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-def-header-"));
    const missing = join(dir, "missing.kumiki");

    const { stderr, code } = run(["add", missing, "widget", "X", "Int = 0"]);

    expect(stderr).toContain("widget");
    // The alternatives, so the caller learns `motion` is one and `widget` is not.
    expect(stderr).toContain("motion");
    expect(stderr).not.toContain("ENOENT");
    expect(code).toBe(2);
  });

  it("adds a motion", SPAWN, () => {
    const file = seed(KIND_BASE);

    const { stderr, code } = run([
      "add",
      file,
      "motion",
      "Fade",
      '{keyframes: {from: {opacity: 0}, to: {opacity: 1}}, duration: "normal"}',
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(readFileSync(file, "utf8")).toContain("motion Fade = {keyframes:");
  });
});
