import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

describe("codegen: effect retry (#83)", () => {
  it("emits a linear retry policy on EffectSpec", () => {
    const src = `
      slot tag : Text = ""
      effect loadX cap=http.get in=Text out=Result(Text, HttpError) retry=linear(3, 500ms)
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('retry: { kind: "linear", n: 3, ms: 500 }');
  });

  it("emits an exponential retry policy on EffectSpec", () => {
    const src = `
      effect loadX cap=http.get in=Text out=Result(Text, HttpError) retry=exponential(5, 200ms, 2.0)
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('retry: { kind: "exponential", n: 5, ms: 200, factor: 2 }');
  });

  it("emits retry: undefined when no retry clause is given", () => {
    const src = `
      effect loadX cap=http.get in=Text out=Result(Text, HttpError)
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("retry: undefined");
  });

  it("emits retry: undefined when retry=none", () => {
    const src = `
      effect loadX cap=http.get in=Text out=Result(Text, HttpError) retry=none
      tile B = button(text="b")
      tile Home = column(B)
      app App caps=[http.get] routes={"/" -> Home, "/404" -> Home} init=[]
    `;
    const result = compile(src, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain("retry: undefined");
  });
});
