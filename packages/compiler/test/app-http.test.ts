import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer.ts";
import { ParseError, parse } from "../src/parser.ts";

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
    expect(app.http?.on401).toBe("handleUnauthorized");
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
    expect(app.http?.on403).toBe("handleForbidden");
    expect(app.http?.on5xx).toBe("handleServerErr");
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
    expect(result.js).toContain('baseUrl: "https://api.example.com"');
    expect(result.js).toContain('on401: "handleUnauthorized"');
    expect(result.js).toContain("headers: () =>");
    expect(result.js).toContain("timeout: 5000");
    expect(result.js).toContain('credentials: "include"');
    expect(result.js).toContain("http: _http,");
    expect(result.js).toMatch(/httpFetch\("GET", \w+, _http\)/);
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
