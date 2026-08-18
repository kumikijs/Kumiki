// `generateDts` writes a file into the user's project (the Vite plugin's
// `types: true`), so its output is only useful if `tsc` accepts it. Asserting
// on substrings cannot tell a declaration that parses from one that does not:
// a hyphenated slot name and a user type named `Slots` both produced text that
// looked right and failed the moment the project compiled. Every case here
// ends at a real TypeScript program with zero diagnostics.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateDts, lex, parse } from "@kumikijs/compiler";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

// Every case here starts a TypeScript program, which is an order of magnitude
// more work than the rest of this package's tests and past the 5 s default on a
// loaded CI runner.
vi.setConfig({ testTimeout: 30_000 });

const dtsOf = (src: string): string => generateDts(parse(lex(src)));

/** Type-check one generated module in isolation; returns formatted diagnostics. */
function tscDiagnostics(source: string): string[] {
  const dir = mkdtempSync(join(TMP_ROOT, "dts-"));
  const file = join(dir, "gen.ts");
  writeFileSync(file, source);
  const program = ts.createProgram([file], {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const text = ts.flattenDiagnosticMessageText(d.messageText, " ");
    return `TS${d.code}: ${text}`;
  });
}

const APP_TAIL = `
  tile App = column(text("x"))
  app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

describe("generateDts output compiles", () => {
  it("quotes a slot name TypeScript cannot take bare", () => {
    const gen = dtsOf(`slot my-slot : Text = ""${APP_TAIL}`);
    // The runtime's own `slots` object keys it `"my-slot"` — the declaration
    // has to describe the shape that exists, not a renamed one.
    expect(gen).toContain('"my-slot": string;');
    expect(tscDiagnostics(gen)).toEqual([]);
  });

  it("leaves an identifier slot name bare", () => {
    expect(dtsOf(`slot count : Int = 0${APP_TAIL}`)).toContain("count: number;");
  });

  it("names its own helpers apart from user types called Provider/Slots/Providers", () => {
    const gen = dtsOf(`
      type Provider = { a: Int }
      type Slots = { b: Int }
      type Providers = { c: Int }
      slot s : Provider = {a: 1}
      ${APP_TAIL}
    `);
    expect(gen).toContain("export type KumikiProvider<In, Out> = (");
    expect(gen).toContain("export interface KumikiSlots {");
    expect(gen).toContain("export interface KumikiProviders {");
    expect(gen).toContain("export type Provider = { a: number };");
    expect(tscDiagnostics(gen)).toEqual([]);
  });

  it("declares a type whose Kumiki name is not a TypeScript identifier, and names it the same way everywhere", () => {
    const gen = dtsOf(`
      type my-type = { a: Int }
      slot s : my-type = {a: 1}
      ${APP_TAIL}
    `);
    expect(gen).toContain("export type my_type = { a: number };");
    expect(gen).toContain("s: my_type;");
    expect(tscDiagnostics(gen)).toEqual([]);
  });

  it("keeps two type names that lower to the same identifier apart", () => {
    const gen = dtsOf(`
      type my-type = { a: Int }
      type my_type = { b: Int }
      slot s : my-type = {a: 1}
      slot t : my_type = {b: 2}
      ${APP_TAIL}
    `);
    expect(tscDiagnostics(gen)).toEqual([]);
    // Whichever spelling keeps the bare name, the two slots must not end up
    // pointing at one declaration.
    const sType = /\bs: (\w+);/.exec(gen)?.[1];
    const tType = /\bt: (\w+);/.exec(gen)?.[1];
    expect(sType).toBeDefined();
    expect(tType).toBeDefined();
    expect(sType).not.toBe(tType);
  });

  it("emits a generic alias with its parameters", () => {
    const gen = dtsOf(`
      type Box(T) = { x: T }
      slot s : Box(Int) = {x: 1}
      ${APP_TAIL}
    `);
    expect(gen).toContain("export type Box<T> = { x: T };");
    expect(gen).toContain("s: Box<number>;");
    expect(tscDiagnostics(gen)).toEqual([]);
  });

  it("keeps two type parameters that lower to the same identifier apart", () => {
    const gen = dtsOf(`
      type Box(a-b, a_b) = { x: a-b, y: a_b }
      slot s : Box(Int, Text) = {x: 1, y: ""}
      ${APP_TAIL}
    `);
    expect(tscDiagnostics(gen)).toEqual([]);
    const params = /export type Box<([^>]*)>/.exec(gen)?.[1]?.split(", ");
    expect(params).toHaveLength(2);
    expect(params?.[0]).not.toBe(params?.[1]);
  });

  it("does not let a type parameter capture a type declared beside it", () => {
    // `f-oo` is the parameter and `f_oo` the record; lowering both to the same
    // identifier makes the alias read as though the field referred to itself.
    // TypeScript is silent about that — it is a valid declaration meaning the
    // wrong thing — so the assertion is on the resolved reference.
    const gen = dtsOf(`
      type f_oo = { a: Int }
      type Box(f-oo) = { x: f-oo, y: f_oo }
      slot s : Box(Int) = {x: 1, y: {a: 1}}
      ${APP_TAIL}
    `);
    expect(tscDiagnostics(gen)).toEqual([]);
    const box = /export type Box<(\w+)> = \{ x: (\w+); y: (\w+) \};/.exec(gen);
    expect(box).not.toBeNull();
    const [, param, x, y] = box as RegExpExecArray;
    expect(x).toBe(param);
    expect(y).not.toBe(param);
    expect(gen).toContain(`export type ${y} = { a: number };`);
  });

  it("keeps a parameter that shadows a declared type meaning the parameter", () => {
    const gen = dtsOf(`
      type T = { a: Int }
      type Box(T) = { x: T }
      slot s : Box(Int) = {x: 1}
      ${APP_TAIL}
    `);
    expect(tscDiagnostics(gen)).toEqual([]);
    const box = /export type Box<(\w+)> = \{ x: (\w+) \};/.exec(gen);
    expect(box).not.toBeNull();
    const [, param, x] = box as RegExpExecArray;
    // Kumiki shadows too, so `x` is the parameter — but it must not be spelled
    // like the record, or the alias would read as the record for a reader.
    expect(x).toBe(param);
    expect(gen).toContain("export type T = { a: number };");
    expect(param).not.toBe("T");
  });

  it("does not declare a type under a name TypeScript reserves", () => {
    // Every one of these is a legal Kumiki type name and an illegal TypeScript
    // alias name (TS2457). One source declaring all of them is one program to
    // check, and any name left unreserved shows up in the same diagnostics.
    const reserved = [
      "any",
      "unknown",
      "never",
      "number",
      "bigint",
      "boolean",
      "string",
      "symbol",
      "object",
      "undefined",
      "void",
    ];
    const gen = dtsOf(`
      ${reserved.map((r) => `type ${r} = { a: Int }`).join("\n")}
      ${reserved.map((r, i) => `slot s${i} : ${r} = {a: 1}`).join("\n")}
      ${APP_TAIL}
    `);
    for (const r of reserved) expect(gen).not.toContain(`export type ${r} =`);
    expect(tscDiagnostics(gen)).toEqual([]);
  });

  it("keeps its own helper name when a user type claims it", () => {
    const gen = dtsOf(`
      type KumikiSlots = { a: Int }
      slot s : KumikiSlots = {a: 1}
      ${APP_TAIL}
    `);
    expect(tscDiagnostics(gen)).toEqual([]);
    // The helpers are the file's public surface — an importer names them — so
    // the user type is the side that moves.
    expect(gen).toContain("export interface KumikiSlots {");
    expect(gen).not.toContain("export type KumikiSlots =");
  });

  it("types a custom-capability provider with the renamed helper", () => {
    const gen = dtsOf(`
      effect track cap=telemetry.track in={name: Text} out=Unit
      reducer fire on=ui.click(B) do= emit track({name: "x"})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(gen).toMatch(/"telemetry\.track"\??: KumikiProvider<\{ name: string \}, null>/);
    expect(tscDiagnostics(gen)).toEqual([]);
  });

  it("compiles everything the other cases exercise at once", () => {
    const gen = dtsOf(`
      type Provider = { a: Int }
      type Slots = { b: Int }
      type my-type = { c: Int }
      type KumikiProviders = { d: Int }
      slot my-slot : my-type = {c: 1}
      slot p : Provider = {a: 1}
      slot q : Slots = {b: 1}
      slot r : KumikiProviders = {d: 1}
      effect track cap=telemetry.track in=my-type out=Provider
      reducer fire on=ui.click(B) do= emit track({c: 1})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(tscDiagnostics(gen)).toEqual([]);
  });
});

describe("the standard library's Route", () => {
  it("carries every field the router produces", () => {
    // routing.md §3.2 lists five; the runtime's `parseLocation` builds five;
    // stdlib.md's row (and this table) had three, so `route.pattern` typed as
    // `unknown` in a generated provider signature.
    const gen = dtsOf(`slot r : Route = {path: "/", pattern: "/", params: {}, query: {}, hash: None}
      tile App = column(text(r.path))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(gen).toContain("path: string");
    expect(gen).toContain("pattern: string");
    expect(gen).toContain("hash: { _tag: \"Some\"; _0: string } | { _tag: \"None\" }");
    expect(tscDiagnostics(gen)).toEqual([]);
  });
});
