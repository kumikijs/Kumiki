import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDef,
  describeEdit,
  editDef,
  LAYERS,
  load,
  patchApplyFile,
  patchRevert,
  readOpLog,
  removeDef,
  replaceDef,
  viewDef,
} from "@kumikijs/cli";
import type { TileDef } from "@kumikijs/compiler";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, SPAWN } from "./helpers/cli.ts";
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
/** The op-id of the op just logged, read off the log rather than off the verb's result. */
const lastOpId = (file: string): string => lastOp(file)["op-id"];
const textOf = (file: string, qname: string): string =>
  defined(viewDef(load(file), qname), `the definition ${qname}`);
const tileOf = (file: string, qname: string): TileDef =>
  defined(load(file).byQName.get(qname), qname).def as TileDef;

/** Rewrite `from` to `to` in the file: an edit the op log does not see. */
const handEdit = (file: string, from: string, to: string): void => {
  const source = readFileSync(file, "utf8");
  expect(source).toContain(from);
  writeFileSync(file, source.replace(from, to));
};

/** Rewrite one op-log entry in place, as an earlier version of the CLI would have logged it. */
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

const APP = `app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

/** A tile with an `error-boundary=` clause, and a second tile it could fall back to. */
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

/** A generic type nothing applies, so its parameters can change. */
const UNUSED_GENERIC = "type Box(T) = {v: T}\n";

/** A comment between the name and what follows it: the `=`, a clause, the parameters. */
const COMMENTED = `slot name : Text = "Ada"

tile Oops = text("boom")
tile G # a note on G
    = heading(name)
tile H # a note on H
    error-boundary=Oops = heading(name)
tile App = column(G)

type Box # a note on Box
    (T) = {v: T}

${APP}`;

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

    expect(tileOf(file, "tile.SettingsLayout").subRoutes?.map((r) => r.path)).toEqual([
      "/settings/account",
      "/settings",
    ]);
    // The header moves up onto the name's line; the rest of it keeps its layout.
    expect(textOf(file, "tile.SettingsLayout")).toBe(
      [
        "tile SettingsLayout sub-routes = {",
        '        "/settings/account" -> AccountSettings,',
        '        "/settings"         -> SettingsHome',
        "    }",
        '    = page(heading("Prefs"), route-outlet())',
      ].join("\n"),
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

  it("drops a type's parameters when the body starts at the `=`", () => {
    const file = seed(UNUSED_GENERIC);

    replaceDef(file, "type.Box", "= {v: Int}");

    expect(textOf(file, "type.Box")).toBe("type Box = {v: Int}");
  });

  it("replaces a type's parameters with the ones a body states", () => {
    const file = seed(UNUSED_GENERIC);

    replaceDef(file, "type.Box", "(A, B) = {first: A, second: B}");

    expect(textOf(file, "type.Box")).toBe("type Box(A, B) = {first: A, second: B}");
  });
});

describe("what replace reports dropping", () => {
  it("names each clause the body no longer states", () => {
    const file = seed(
      NESTED.replace(
        "tile SettingsLayout\n",
        'tile Oops = text("boom")\n\ntile SettingsLayout error-boundary=Oops\n',
      ),
    );

    const result = replaceDef(
      file,
      "tile.SettingsLayout",
      'sub-routes = {"/settings/account" -> AccountSettings, "/settings" -> SettingsHome} = page(heading("Prefs"), route-outlet())',
    );

    expect(result.dropped).toEqual(["error-boundary"]);
    expect(describeEdit({ op: "replace", qname: "tile.SettingsLayout", ...result })).toBe(
      `replaced tile.SettingsLayout  (${result.opId})\n  dropped error-boundary`,
    );
  });

  it("names each parameter the body no longer states", () => {
    const file = seed(UNUSED_GENERIC);

    expect(replaceDef(file, "type.Box", "= {v: Int}").dropped).toEqual(["parameter T"]);
  });

  it("names nothing when the body keeps the clauses", () => {
    const file = seed(BOUNDARY);

    const result = replaceDef(file, "tile.Greeting", 'heading("Hello")');

    expect(textOf(file, "tile.Greeting")).toBe(
      'tile Greeting error-boundary=Oops = heading("Hello")',
    );
    expect(result.dropped).toEqual([]);
    expect(describeEdit({ op: "replace", qname: "tile.Greeting", ...result })).toBe(
      `replaced tile.Greeting  (${result.opId})`,
    );
  });
});

describe("a comment after the name", () => {
  it("is not taken for clauses", () => {
    const file = seed(COMMENTED);

    replaceDef(file, "tile.G", 'heading("Yo")');

    expect(textOf(file, "tile.G")).toBe('tile G = heading("Yo")');
  });

  it("does not stop replace from keeping the clauses after it", () => {
    const file = seed(COMMENTED);

    replaceDef(file, "tile.H", 'heading("Yo")');

    expect(textOf(file, "tile.H")).toBe('tile H error-boundary=Oops = heading("Yo")');
  });

  it("does not stop replace from keeping a type's parameters after it", () => {
    const file = seed(COMMENTED);

    replaceDef(file, "type.Box", "{v: T, n: Int}");

    expect(textOf(file, "type.Box")).toBe("type Box(T) = {v: T, n: Int}");
  });

  it("does not stop a removed tile with clauses from coming back", () => {
    const file = seed(COMMENTED);
    removeDef(file, "tile.H", false);

    patchRevert(file, lastOpId(file));

    expect(tileOf(file, "tile.H").errorBoundary).toBe("Oops");
    expect(textOf(file, "tile.H")).toBe("tile H error-boundary=Oops = heading(name)");
  });
});

const TYPE_RIGHT_HAND_SIDES = ["T", "Option(T)", "{v: T}", "nominal Int", "Red | Green"];
const TILE_RIGHT_HAND_SIDES = [
  "heading($1)",
  'for t in ["1", "2"] text($1 + t)',
  'when($1 == "", text("empty"))',
  'if $1 == "" then text("none") else text($1)',
  "match $1 with | t -> text(t)",
];

describe("a right-hand side is never read as a header", () => {
  it.each(TYPE_RIGHT_HAND_SIDES)("type: %s", (rhs) => {
    const file = seed(UNUSED_GENERIC);

    replaceDef(file, "type.Box", rhs);

    expect(textOf(file, "type.Box")).toBe(`type Box(T) = ${rhs}`);
  });

  it.each(TILE_RIGHT_HAND_SIDES)("tile: %s", (rhs) => {
    const file = seed(INPUT);

    replaceDef(file, "tile.Greeting", rhs);

    expect(textOf(file, "tile.Greeting")).toBe(`tile Greeting in=Text = ${rhs}`);
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
    const file = seed("slot n : Int = 0\n");

    expect(() => addDef(file, "type", "Box(T)", "{v: T}")).toThrowError(/"Box\(T\)"/);

    expect(readFileSync(file, "utf8")).toBe("slot n : Int = 0\n");
    expect(existsSync(logPath(file))).toBe(false);
  });
});

describe("patch revert of a replace or an edit", () => {
  it("restores the body the previous edit left, clauses included", () => {
    const file = seed(INPUT);
    editDef(file, "tile.Greeting", { find: "Hi, ", replace: "Hello, " });
    editDef(file, "tile.Greeting", { find: "Hello, ", replace: "Hey, " });

    patchRevert(file, lastOpId(file));

    expect(textOf(file, "tile.Greeting")).toBe('tile Greeting in=Text = heading("Hello, " + $1)');
  });

  it("restores a tile that had no clauses before a replace gave it one", () => {
    const file = seed(BOUNDARY);
    addDef(file, "tile", "Plain", 'heading("Hi")');
    replaceDef(file, "tile.Plain", 'error-boundary=Oops = heading("Hi")');

    patchRevert(file, lastOpId(file));

    expect(textOf(file, "tile.Plain")).toBe('tile Plain = heading("Hi")');
  });

  it("puts back a clause the op log never saw", () => {
    const file = seed(BOUNDARY);
    addDef(file, "tile", "X", 'text("a")');
    handEdit(file, 'tile X = text("a")', 'tile X error-boundary=Oops = text("a")');
    replaceDef(file, "tile.X", 'text("b")');

    patchRevert(file, lastOpId(file));

    expect(textOf(file, "tile.X")).toBe('tile X error-boundary=Oops = text("a")');
  });

  it("restores the definition the second of two replaces replaced", () => {
    const file = seed(BOUNDARY);
    replaceDef(file, "tile.Greeting", 'heading("One")');
    replaceDef(file, "tile.Greeting", 'heading("Two")');

    patchRevert(file, lastOpId(file));

    expect(textOf(file, "tile.Greeting")).toBe(
      'tile Greeting error-boundary=Oops = heading("One")',
    );
  });

  it("reverts a replace of a definition no op created", () => {
    const file = seed("slot count : Int = 0\n");
    replaceDef(file, "slot.count", "Int = 5");

    patchRevert(file, lastOpId(file));

    expect(textOf(file, "slot.count")).toBe("slot count : Int = 0");
  });

  it("reverts an edit of a generic type no op created", () => {
    const file = seed(GENERIC);
    editDef(file, "type.Box", { find: "{v: T}", replace: "{v: T, w: T}" });

    patchRevert(file, lastOpId(file));

    expect(textOf(file, "type.Box")).toBe("type Box(T) = {v: T}");
  });

  it("refuses a logged body that is a whole definition, writing nothing", () => {
    const file = seed(INPUT);
    const first = editDef(file, "tile.Greeting", { find: "Hi, ", replace: "Hello, " });
    const second = editDef(file, "tile.Greeting", { find: "Hello, ", replace: "Hey, " });
    rewriteLogEntry(file, first, (e) => {
      e.body = 'tile Greeting in=Text = heading("Hello, " + $1)';
    });
    rewriteLogEntry(file, second, (e) => {
      delete e.prev;
    });
    const before = readFileSync(file, "utf8");

    expect(() => patchRevert(file, second)).toThrowError(/whole definition/);

    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("a logged body means one thing", () => {
  it("states that a tile has no clauses", () => {
    const file = seed(BOUNDARY);

    addDef(file, "tile", "X", 'text("a")');
    expect(lastOp(file).body).toBe('= text("a")');
    replaceDef(file, "tile.X", 'text("b")');
    expect(lastOp(file).body).toBe('= text("b")');
  });

  it("so patch apply writes the definition the op wrote, whatever clauses the tile has now", () => {
    const file = seed(BOUNDARY);
    addDef(file, "tile", "X", 'text("a")');
    replaceDef(file, "tile.X", 'text("b")');
    const { op, layer, name, body } = lastOp(file);
    handEdit(file, 'tile X = text("b")', 'tile X error-boundary=Oops = text("b")');
    const ops = join(dir, "ops.jsonl");
    writeFileSync(ops, `${JSON.stringify({ op, layer, name, body })}\n`);

    patchApplyFile(file, ops);

    expect(textOf(file, "tile.X")).toBe('tile X = text("b")');
  });
});

const KINDS: { layer: string; name: string; body: string; logged?: string }[] = [
  { layer: "type", name: "Point", body: "{x: Int, y: Int}", logged: "= {x: Int, y: Int}" },
  { layer: "type", name: "Pair", body: "(A, B) = {first: A, second: B}" },
  { layer: "slot", name: "m", body: "Int = 1" },
  { layer: "effect", name: "save", body: "cap=storage.write in=Int out=Result(Unit, Text)" },
  { layer: "reducer", name: "reset", body: "on=ui.click(ResetBtn) do= n := 0" },
  { layer: "tile", name: "Plain", body: 'text("a")', logged: '= text("a")' },
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

  it.each(KINDS)("$layer $name: add and remove log one body, and revert restores it", ({
    layer,
    name,
    body,
    logged = body,
  }) => {
    const file = seed(KIND_BASE);
    const qname = `${layer}.${name}`;
    addDef(file, layer, name, body);
    expect(lastOp(file).body).toBe(logged);
    const added = textOf(file, qname);

    const { opId } = removeDef(file, qname, false);
    expect(lastOp(file).bodies?.[0]?.body).toBe(logged);

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

describe("kumiki add and replace, the commands", () => {
  it("rejects a layer that labels no definition with 2, before reading the file", SPAWN, () => {
    dir = mkdtempSync(join(tmpdir(), "kumiki-def-header-"));
    const missing = join(dir, "missing.kumiki");

    const { stderr, code } = runCli(["add", missing, "widget", "X", "Int = 0"]);

    expect(stderr).toContain("widget");
    // The alternatives, so the caller learns `motion` is one and `widget` is not.
    expect(stderr).toContain("motion");
    expect(stderr).not.toContain("ENOENT");
    expect(code).toBe(2);
  });

  it("adds a motion", SPAWN, () => {
    const file = seed(KIND_BASE);

    const { stderr, code } = runCli([
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

  it("replace prints the clauses the body dropped", SPAWN, () => {
    const file = seed(BOUNDARY);

    const { stdout, code } = runCli(["replace", file, "tile.Greeting", '= heading("Hello")']);

    expect(stdout).toContain("\n  dropped error-boundary");
    expect(code).toBe(0);
  });
});
