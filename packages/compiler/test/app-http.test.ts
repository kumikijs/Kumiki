import { check, compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer.ts";
import { ParseError, parse } from "../src/parser.ts";
import { defined } from "./helpers/defined.ts";

describe("parser: app.http (#78)", () => {
  it("captures base-url, headers, on-401, timeout, credentials", () => {
    const src = `
      slot tag : Text = ""
      reducer handleUnauthorized on=ui.click(B) do= tag := "401"
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [http.get]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        http = {
          base-url: "https://api.example.com",
          headers: { "Authorization": "Bearer token" },
          on-401: handleUnauthorized,
          timeout: 5000,
          credentials: "include"
        }
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    expect(app?.kind).toBe("AppDef");
    if (app?.kind !== "AppDef") return;
    expect(app.http).toBeDefined();
    expect(app.http?.baseUrl?.kind).toBe("Str");
    expect(app.http?.headers?.kind).toBe("MapLit");
    expect(app.http?.on401?.name).toBe("handleUnauthorized");
    expect(app.http?.timeout?.kind).toBe("Num");
    expect(app.http?.credentials?.kind).toBe("Str");
  });

  it("captures on-403 and on-5xx reducer names", () => {
    const src = `
      slot tag : Text = ""
      reducer handleForbidden on=ui.click(B) do= tag := "403"
      reducer handleServerErr on=ui.click(B) do= tag := "5xx"
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [http.get]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        http = {
          on-403: handleForbidden,
          on-5xx: handleServerErr
        }
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.http?.on403?.name).toBe("handleForbidden");
    expect(app.http?.on5xx?.name).toBe("handleServerErr");
    // The name carries where it was written, so a diagnostic and a rename
    // both land on the handler rather than on the `app`.
    expect(app.http?.on5xx?.pos.line).toBeGreaterThan(app.http?.on403?.pos.line ?? 0);
  });

  it("leaves http undefined when app has no http block", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.http).toBeUndefined();
  });

  it("rejects non-reducer-name value for on-401", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps = [http.get]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        http = { on-401: "stringLiteral" }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });
});

describe("codegen: app.http (#78)", () => {
  it("emits _http config and threads it to httpFetch", () => {
    const src = `
      slot tag : Text = ""
      reducer handleUnauthorized on=ui.click(B) do= tag := "401"
      tile B = button(text="b")
      tile Home = column(B)
      effect loadX cap=http.get in=Text out=Result(Text, HttpError)
      app App
        caps = [http.get]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        http = {
          base-url: "https://api.example.com",
          headers: { "X-App": "Kumiki" },
          on-401: handleUnauthorized,
          timeout: 5000,
          credentials: "include"
        }
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Every field the author writes an expression for is deferred — the three
    // scalars as getters, `headers` as the thunk the runtime calls — so each is
    // read when a request is made. A literal is emitted the same way, so the
    // shape never depends on what was written.
    expect(result.js).toContain('get baseUrl() { return "https://api.example.com"; }');
    expect(result.js).toContain('on401: "handleUnauthorized"');
    expect(result.js).toContain("headers: () =>");
    expect(result.js).toContain("get timeout() { return 5000; }");
    expect(result.js).toContain('get credentials() { return "include"; }');
    expect(result.js).toContain("http: _http,");
    expect(result.js).toMatch(/httpFetch\("GET", \w+, _http, _signal\)/);
  });

  it("lowers a slot reference inside the getter body, in the non-reducer scope", () => {
    // The literal cases above pin the shape and say nothing about what goes
    // inside it. `_next` is local to a reducer's generated body, so a scope
    // flipped to the reducer one would put an unreachable name in every getter
    // — a ReferenceError on the first request, from a change that looks like a
    // one-word cleanup here.
    const src = `
      slot endpoint    : Text = "https://api.example.com"
      slot timeoutMs   : Int  = 5000
      slot sendCookies : Text = "include"
      tile B = button(text="b")
      tile Home = column(B)
      effect loadX cap=http.get in=Text out=Result(Text, HttpError)
      app App
        caps = [http.get]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        http = { base-url: endpoint, timeout: timeoutMs, credentials: sendCookies }
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('get baseUrl() { return _live["endpoint"]; }');
    expect(result.js).toContain('get timeout() { return _live["timeoutMs"]; }');
    expect(result.js).toContain('get credentials() { return _live["sendCookies"]; }');
    const config = defined(
      result.js.split("\n").find((l) => l.startsWith("const _http = ")),
      "the emitted _http line",
    );
    expect(config).not.toContain("_next");
  });

  it("reports a name in an http field that resolves to nothing", () => {
    // Nothing else looks at these expressions, and each is read inside a
    // request — so an unresolved name reaches the runtime as a throw the
    // dispatcher turns into an `err` result, which an `.err` reducer absorbs.
    const src = `
      slot endpoint : Text = "https://api.example.com"
      tile B = button(text="b")
      tile Home = column(B)
      effect loadX cap=http.get in=Text out=Result(Text, HttpError)
      app App
        caps = [http.get]
        routes = {"/" -> Home, "/404" -> Home}
        init = []
        http = { base-url: endpointt }
    `;
    const errs = check(parse(lex(src)));
    expect(errs.map((e) => `${e.code} ${e.message}`)).toEqual([
      'E0103 Reference to undefined name "endpointt"',
    ]);
  });

  it("emits const _http = undefined when app has no http block", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("const _http = undefined;");
  });
});
