import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { compileOrFail } from "./helpers/module.ts";

const FIXTURE = `
slot _ : Text = ""

tile A = icon(name="check")
tile B = icon(name="info") {size: "lg"}
tile C = icon(name="check") {color: "success"}
tile Root = column(A, B, C)

app IconApp
    caps   = []
    routes = {"/" -> Root, "/404" -> Root}
    init   = []
`;

describe("icon registry codegen", () => {
  it("surfaces every literal name referenced by icon(name=...)", () => {
    const result = compile(FIXTURE, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.usedIcons).toEqual(["check", "info"]);
  });

  it("emits NO App.icons literal when no icons option is supplied (backwards compat)", () => {
    const js = compileOrFail(FIXTURE);
    expect(js).not.toContain("App.icons");
  });

  it("bakes only USED entries from the icons option into App.icons", () => {
    const registry = {
      check: "M4 12l6 6L20 6",
      info: "M12 2v20",
      "x-circle": "M0 0L24 24",
    };
    const js = compileOrFail(FIXTURE, {
      runtimeSpecifier: "./runtime.js",
      icons: registry,
    });
    expect(js).toContain("App.icons = {");
    expect(js).toContain('"check": "M4 12l6 6L20 6"');
    expect(js).toContain('"info": "M12 2v20"');
    expect(js).not.toContain("x-circle");
  });

  it("a name absent from the registry is silently skipped (theme.icons still wins)", () => {
    const js = compileOrFail(FIXTURE, {
      runtimeSpecifier: "./runtime.js",
      icons: { info: "M12 2v20" }, // only info, not check
    });
    expect(js).toContain('"info": "M12 2v20"');
    expect(js).not.toMatch(/"check":\s*"M/);
  });

  it("does not capture dynamic (non-literal) name expressions", () => {
    const dyn = `
      slot x : Text = "check"
      tile A = icon(name=x)
      tile Root = column(A)
      app D caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
    `;
    const result = compile(dyn, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.usedIcons).toEqual([]);
  });
});

describe("icon registry strict mode", () => {
  const BAD = `
    slot _ : Text = ""
    tile Bad = icon(name="cheque")
    tile Root = column(Bad)
    app A caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
  `;

  it("default (strictIcons unset) lets unknown literal names pass", () => {
    const result = compile(BAD, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
  });

  it("strictIcons=true flags an unknown literal name as E0704", () => {
    const result = compile(BAD, {
      runtimeSpecifier: "./runtime.js",
      strictIcons: true,
      iconNames: ["check", "info"],
    });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors).toHaveLength(1);
    const error = defined(result.errors[0], "the unknown-icon error");
    expect(error.code).toBe("E0704");
    expect(error.kind).toBe("unknown-icon");
    expect(error.message).toContain("cheque");
    expect(error.pos.line).toBe(3);
    expect(error.pos.col).toBeGreaterThan(0);
  });

  it("strictIcons=true accepts a name in the supplied registry", () => {
    const ok = `
      slot _ : Text = ""
      tile Good = icon(name="check")
      tile Root = column(Good)
      app A caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
    `;
    const result = compile(ok, {
      runtimeSpecifier: "./runtime.js",
      strictIcons: true,
      iconNames: ["check"],
    });
    expect(result.kind).toBe("ok");
  });

  it("strictIcons=true accepts names from the iconNames ∪ theme.icons union", () => {
    const union = `
      slot _ : Text = ""
      tile A = icon(name="check")
      tile B = icon(name="logo")
      tile Root = column(A, B)
      theme Light = { icons: { logo: "M3 3h18v18H3z" } }
      app A2 caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
    `;
    const result = compile(union, {
      runtimeSpecifier: "./runtime.js",
      strictIcons: true,
      iconNames: ["check"],
    });
    expect(result.kind).toBe("ok");
  });

  it("strictIcons=true accepts a name declared in any theme.icons block", () => {
    const themed = `
      slot _ : Text = ""
      tile Good = icon(name="logo")
      tile Root = column(Good)
      theme Light = { icons: { logo: "M3 3h18v18H3z" } }
      app A caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
    `;
    const result = compile(themed, {
      runtimeSpecifier: "./runtime.js",
      strictIcons: true,
      iconNames: [],
    });
    expect(result.kind).toBe("ok");
  });

  it("strictIcons=true skips dynamic (non-literal) icon(name=<expr>) calls", () => {
    const dyn = `
      slot x : Text = "cheque"
      tile A = icon(name=x)
      tile Root = column(A)
      app A2 caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
    `;
    const result = compile(dyn, {
      runtimeSpecifier: "./runtime.js",
      strictIcons: true,
      iconNames: ["check"],
    });
    expect(result.kind).toBe("ok");
  });

  it("strictIcons=true flags every distinct unknown name independently", () => {
    const multi = `
      slot _ : Text = ""
      tile A = icon(name="cheque")
      tile B = icon(name="infoo")
      tile Root = column(A, B)
      app A2 caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
    `;
    const result = compile(multi, {
      runtimeSpecifier: "./runtime.js",
      strictIcons: true,
      iconNames: ["check", "info"],
    });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.code)).toEqual(["E0704", "E0704"]);
    const messages = result.errors.map((e) => e.message).join(" | ");
    expect(messages).toContain("cheque");
    expect(messages).toContain("infoo");
  });
});
