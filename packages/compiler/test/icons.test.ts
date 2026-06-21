// Compiler-side wiring for the icon registry (#101): literal icon names get
// surfaced on the compile result, and the second-pass `icons` codegen option
// bakes ONLY the referenced entries into the emitted `App.icons` map.

import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
    const result = compile(FIXTURE, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).not.toContain("App.icons");
  });

  it("bakes only USED entries from the icons option into App.icons", () => {
    const registry = {
      check: "M4 12l6 6L20 6",
      info: "M12 2v20",
      // Not referenced — must NOT appear in the output.
      "x-circle": "M0 0L24 24",
    };
    const result = compile(FIXTURE, {
      runtimeSpecifier: "./runtime.js",
      icons: registry,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("App.icons = {");
    expect(result.js).toContain('"check": "M4 12l6 6L20 6"');
    expect(result.js).toContain('"info": "M12 2v20"');
    expect(result.js).not.toContain("x-circle");
  });

  it("a name absent from the registry is silently skipped (theme.icons still wins)", () => {
    const result = compile(FIXTURE, {
      runtimeSpecifier: "./runtime.js",
      icons: { info: "M12 2v20" }, // only info, not check
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('"info": "M12 2v20"');
    // `check` is referenced but absent from the supplied registry — the bake
    // step skips it, leaving runtime resolution to theme.icons.
    expect(result.js).not.toMatch(/"check":\s*"M/);
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
