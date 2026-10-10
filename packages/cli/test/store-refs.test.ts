import { readFileSync } from "node:fs";
import {
  directDeps,
  findReferences,
  listDefs,
  load,
  readOpLog,
  removeDef,
  renameDef,
  viewDef,
} from "@kumikijs/cli";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { APP_A, seed, seedCopy } from "./helpers/files.ts";

const COUNTER = app("01-counter");
const TODOMVC = app("02-todomvc");

const qnamesOf = (refs: { qname: string }[]): string[] => refs.map((r) => r.qname).sort();

describe("kumiki store: list / view / refs", () => {
  it("lists every layer todomvc defines", () => {
    const layers = new Set<string>(listDefs(load(TODOMVC)).map((e) => e.layer));
    for (const layer of ["type", "slot", "effect", "reducer", "fn", "tile", "app", "theme"]) {
      expect(layers).toContain(layer);
    }
  });

  it("views a specific slot", () => {
    const text = viewDef(load(TODOMVC), "slot.todos");
    expect(text).toContain("slot todos");
    expect(text).toContain("Map(TodoId, Todo)");
  });

  it("finds references to slot.todos", () => {
    const names = new Set(qnamesOf(findReferences(load(TODOMVC), "slot.todos")));
    for (const reducer of ["addTodo", "toggle", "remove", "clearDone"]) {
      expect(names).toContain(`reducer.${reducer}`);
    }
  });
});

describe("references resolve through the AST, not the source text", () => {
  const AMBIGUOUS = `type ItemId = nominal Text where len-eq(3)
type Item   = {id: ItemId, label: Text}

# a counter whose label says count
slot label : Text = "hi"
slot count : Int  = 0

reducer bump on=ui.click(Btn) do= count := count + 1

tile Btn = button(text="label", onClick=bump)
tile App = column(Btn, text(label))

${APP_A}`;

  it("renames a slot without touching a record field, a comment or a string of the same name", () => {
    const f = seed(AMBIGUOUS);
    renameDef(f, "slot.label", "caption");
    const out = readFileSync(f, "utf8");
    expect(out).toContain("type Item   = {id: ItemId, label: Text}");
    expect(out).toContain("slot caption : Text");
    expect(out).toContain("text(caption)");
    expect(out).toContain("# a counter whose label says count");
    expect(out).toContain('button(text="label"');
  });

  it("does not count a definition as a reference to itself", () => {
    const store = load(COUNTER);
    for (const e of listDefs(store)) {
      const q = `${e.layer}.${e.name}`;
      expect(qnamesOf(findReferences(store, q))).not.toContain(q);
    }
  });

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

    expect(qnamesOf(findReferences(store, "slot.count"))).toEqual([
      "reducer.dec",
      "reducer.inc",
      "reducer.reset",
      "tile.App",
    ]);
    expect(qnamesOf(findReferences(store, "type.N"))).toEqual(["slot.count"]);
    expect(qnamesOf(findReferences(store, "tile.IncBtn"))).toEqual(["reducer.inc", "tile.App"]);
  });

  it("keeps a definition out of its own reference list even when it recurses", () => {
    const f = seed(`slot depth : Int = 0
fn countdown(n: Int) -> Int = if n <= 0 then 0 else countdown(n - 1)
tile Node = column(text(depth.show), Node)
tile App = column(Node, text(countdown(depth).show))

${APP_A}`);
    const store = load(f);
    expect(directDeps(store, "fn.countdown")).toEqual([]);
    expect(directDeps(store, "tile.Node")).toEqual(["slot.depth"]);
    expect(qnamesOf(findReferences(store, "tile.Node"))).toEqual(["tile.App"]);
  });

  it("cascade removal reports every definition it deletes, as one op", () => {
    const f = seedCopy(COUNTER);
    const { removed } = removeDef(f, "slot.count", true);
    expect(removed[0]).toBe("slot.count");
    expect([...removed].sort()).toEqual([
      "app.Counter",
      "reducer.dec",
      "reducer.inc",
      "reducer.reset",
      "slot.count",
      "tile.App",
    ]);
    expect(
      listDefs(load(f))
        .map((e) => `${e.layer}.${e.name}`)
        .sort(),
    ).toEqual(["tile.DecBtn", "tile.IncBtn", "tile.ResetBtn", "type.N"]);
    const log = readOpLog(f);
    expect(log).toHaveLength(1);
    expect(log[0]?.removed).toEqual(removed);
    expect(log[0]?.cascade).toBe(true);
  });
});
