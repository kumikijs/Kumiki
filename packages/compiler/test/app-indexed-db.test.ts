import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer.ts";
import { ParseError, parse } from "../src/parser.ts";

describe("parser: app.indexed-db (#79)", () => {
  it("captures name / version / stores with optional indexes", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [indexed.read, indexed.write]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        indexed-db = {
          name: "myapp",
          version: 2,
          stores: [
            {name: "todos", key: "id"},
            {name: "drafts", key: "id", indexes: ["createdAt", "author"]}
          ]
        }
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.indexedDb).toBeDefined();
    expect(app.indexedDb?.name).toBe("myapp");
    expect(app.indexedDb?.version).toBe(2);
    expect(app.indexedDb?.stores).toHaveLength(2);
    expect(app.indexedDb?.stores[0]).toEqual({ name: "todos", key: "id" });
    expect(app.indexedDb?.stores[1]).toEqual({
      name: "drafts",
      key: "id",
      indexes: ["createdAt", "author"],
    });
  });

  it("leaves indexedDb undefined when app has no indexed-db block", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.indexedDb).toBeUndefined();
  });

  it("rejects non-literal name", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [indexed.read]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        indexed-db = { name: 42, version: 1, stores: [{name: "x", key: "id"}] }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });

  it("rejects missing required fields", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [indexed.read]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        indexed-db = { name: "x", version: 1, stores: [] }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });
});

describe("codegen: app.indexed-db (#79)", () => {
  it("emits _idb literal and threads it to indexed-* handlers", () => {
    const src = `
      type Note = {id: Text, body: Text}
      slot id : Text = ""
      effect loadNote   cap=indexed.read   in=Text out=Result(Option(Note), Text)
                        map-request={store: "notes", key: $1, decode: Decoder.Json(Note)}
      effect saveNote   cap=indexed.write  in=Note out=Result(Unit, Text)
                        map-request={store: "notes", key: $1.id, value: $1}
      effect deleteNote cap=indexed.delete in=Text out=Result(Unit, Text)
                        map-request={store: "notes", key: $1}
      reducer load on=ui.click(B) do= emit loadNote(id)
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [indexed.read, indexed.write, indexed.delete]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        indexed-db = {
          name: "notes-db",
          version: 1,
          stores: [{name: "notes", key: "id", indexes: ["createdAt"]}]
        }
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain(
      `const _idb = {"name":"notes-db","version":1,"stores":[{"name":"notes","key":"id","indexes":["createdAt"]}]};`,
    );
    expect(result.js).toContain("indexedDb: _idb,");
    expect(result.js).toMatch(/indexedRead\(\w+, _idb\)/);
    expect(result.js).toMatch(/indexedWrite\(\w+, _idb\)/);
    expect(result.js).toMatch(/indexedDelete\(\w+, _idb\)/);
  });

  it("emits const _idb = undefined when app has no indexed-db block", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("const _idb = undefined;");
  });
});
