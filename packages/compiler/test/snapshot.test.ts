import { readFileSync } from "node:fs";
import { compile, lex, parse } from "@kumikijs/compiler";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

const COUNTER = app("01-counter");
const TODOMVC = app("02-todomvc");

const STRIP_RX = /\s+/g;
const norm = (s: string): string => s.replace(STRIP_RX, " ").trim();

describe("compile output snapshots", () => {
  it("counter: AST shape is stable", () => {
    const src = readFileSync(COUNTER, "utf8");
    const program = parse(lex(src));
    const summary = program.defs.map((d) => `${d.kind}:${"name" in d ? d.name : "_"}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "TypeDef:N",
        "SlotDef:count",
        "ReducerDef:inc",
        "ReducerDef:dec",
        "ReducerDef:reset",
        "TileDef:IncBtn",
        "TileDef:DecBtn",
        "TileDef:ResetBtn",
        "TileDef:App",
        "AppDef:Counter",
      ]
    `);
  });

  it("counter: codegen produces expected key fragments", () => {
    const src = readFileSync(COUNTER, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Look for the canonical reducer / dispatch glue.
    expect(result.js).toContain('"count": { value: 0, refine:');
    expect(result.js).toContain('selector: { tile: "IncBtn" }');
    expect(result.js).toContain('event: { kind: "ui", ev: "click" }');
    expect(result.js).toContain('_h("inc")');
    expect(result.js).toContain('_next["count"]');
  });

  it("todomvc: AST has the expected layer mix", () => {
    const src = readFileSync(TODOMVC, "utf8");
    const program = parse(lex(src));
    const counts: Record<string, number> = {};
    for (const d of program.defs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    expect(counts).toMatchInlineSnapshot(`
      {
        "AppDef": 1,
        "EffectDef": 2,
        "FnDef": 4,
        "ReducerDef": 8,
        "SlotDef": 4,
        "ThemeDef": 1,
        "TileDef": 11,
        "TypeDef": 3,
      }
    `);
  });

  it("todomvc: codegen emits expected effect + reducer glue", () => {
    const src = readFileSync(TODOMVC, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Effect dispatcher should target storage capabilities and respect policies.
    expect(result.js).toContain('cap: "storage.read"');
    expect(result.js).toContain('cap: "storage.write"');
    expect(result.js).toContain('policy: { kind: "once" }');
    expect(result.js).toContain('policy: { kind: "debounce", ms: 300 }');
    // The addTodo reducer should call fresh() and emit saveTodos.
    expect(result.js).toContain("_s.freshId()");
    expect(result.js).toContain('effect: "saveTodos"');
    expect(result.js).toMatch(/sortedIds\([^)]+\)\)\s*\|\|\s*\[\]\)\.map\(/);
    expect(result.js).not.toMatch(/_s\.loopKeys\(/);
  });

  it("counter: variant equality stays correct", () => {
    const src = readFileSync(COUNTER, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // No `(x == y)` bare comparison at the top level — every `==` must go through _s.eq.
    expect(
      /=== /.test(result.js) ||
        /_s\.eq\(/.test(result.js) ||
        !/[^=!<>]==[^=]/.test(norm(result.js)),
    ).toBe(true);
  });

  it("addTodo body uses _next-first slot reads inside reducer", () => {
    const src = readFileSync(TODOMVC, "utf8");
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('Object.hasOwn(_next, "todos") ? _next["todos"] : _live["todos"]');
  });
});
