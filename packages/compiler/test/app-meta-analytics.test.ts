import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { lex } from "../src/lexer.ts";
import { ParseError, parse } from "../src/parser.ts";

describe("parser: app.meta (#80)", () => {
  it("captures the closed set of head fields", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps   = []
        routes = {"/" -> Home, "/404" -> Home}
        init   = []
        meta   = {
          title: "Hello",
          description: "Demo",
          og-image: "/og.png",
          favicon: "/favicon.ico"
        }
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.meta).toBeDefined();
    expect(app.meta?.title).toBe("Hello");
    expect(app.meta?.description).toBe("Demo");
    expect(app.meta?.ogImage).toBe("/og.png");
    expect(app.meta?.favicon).toBe("/favicon.ico");
  });

  it("leaves meta undefined when not declared", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.meta).toBeUndefined();
  });

  it("rejects unknown meta fields", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps   = []
        routes = {"/" -> Home, "/404" -> Home}
        init   = []
        meta   = { keywords: "x" }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });

  it("rejects non-string title", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps   = []
        routes = {"/" -> Home, "/404" -> Home}
        init   = []
        meta   = { title: 42 }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });
});

describe("parser: app.analytics (#80)", () => {
  it("captures provider and optional app-id", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps      = [analytics.send]
        routes    = {"/" -> Home, "/404" -> Home}
        init      = []
        analytics = { provider: "console", app-id: "demo" }
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.analytics).toEqual(expect.objectContaining({ provider: "console", appId: "demo" }));
  });

  it("accepts noop provider without app-id", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps      = [analytics.send]
        routes    = {"/" -> Home, "/404" -> Home}
        init      = []
        analytics = { provider: "noop" }
    `;
    const program = parse(lex(src));
    const app = program.defs.find((d) => d.kind === "AppDef");
    if (app?.kind !== "AppDef") throw new Error("no app");
    expect(app.analytics?.provider).toBe("noop");
    expect(app.analytics?.appId).toBeUndefined();
  });

  it("rejects unknown provider value", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps      = [analytics.send]
        routes    = {"/" -> Home, "/404" -> Home}
        init      = []
        analytics = { provider: "segment" }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });

  it("rejects missing provider", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps      = [analytics.send]
        routes    = {"/" -> Home, "/404" -> Home}
        init      = []
        analytics = { app-id: "demo" }
    `;
    expect(() => parse(lex(src))).toThrow(ParseError);
  });
});

describe("codegen: app.meta / app.analytics (#80)", () => {
  it("emits meta and analytics literals on the App object", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App
        caps      = [analytics.send]
        routes    = {"/" -> Home, "/404" -> Home}
        init      = []
        meta      = { title: "Hello", description: "D", og-image: "/og.png", favicon: "/favicon.ico" }
        analytics = { provider: "console", app-id: "demo" }
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain(
      `meta: {"title":"Hello","description":"D","ogImage":"/og.png","favicon":"/favicon.ico"},`,
    );
    expect(result.js).toContain(`analytics: {"provider":"console","appId":"demo"},`);
  });

  it("omits meta/analytics keys when not declared", () => {
    const src = `
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).not.toContain("meta:");
    expect(result.js).not.toContain("analytics:");
  });
});
