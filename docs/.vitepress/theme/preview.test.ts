import { describe, expect, it } from "vitest";
import { buildSrcdoc, capabilities, compileExample, examples } from "./preview";

// AC — shared compile→preview pipeline (playground editor + home-page demo):
//  1. the example catalog loads from packages/examples and is name-sorted;
//     the capability manifest (kumiki.caps.json) is honored
//  2. buildSrcdoc embeds the compiled JS as a module script plus the sandbox
//     seams: memory router, demo http.get/telemetry.track providers, and the
//     localStorage shim for the opaque origin
//  3. compileExample compiles a real committed example into a srcdoc
//  4. compileExample reports unknown names as an error result, not a throw

describe("preview pipeline", () => {
  it("AC1: loads the sorted example catalog and the capability manifest", () => {
    expect(examples.length).toBeGreaterThan(20);
    const names = examples.map((e) => e.name);
    expect([...names].sort()).toEqual(names);
    expect(names).toContain("19-effect-http.kumiki");
    expect(capabilities).toContain("telemetry.track");
  });

  it("AC2: buildSrcdoc embeds the app JS and every sandbox seam", () => {
    const srcdoc = buildSrcdoc("console.log('app-module-here')");
    expect(srcdoc).toContain("<script type=\"module\">console.log('app-module-here')");
    expect(srcdoc).toContain('router: "memory"');
    expect(srcdoc).toContain("/api/quote");
    expect(srcdoc).toContain("telemetry.track");
    expect(srcdoc).toContain("localStorage");
    // http.get must resolve asynchronously so Loading states actually paint
    expect(srcdoc).toMatch(/setTimeout\(\(\) => resolve\(response\), \d+\)/);
  });

  it("AC3: compileExample turns a committed example into a runnable srcdoc", () => {
    const r = compileExample("19-effect-http.kumiki");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.srcdoc).toContain('<script type="module">');
      expect(r.srcdoc).toContain("fetchQuote");
    }
  });

  it("AC4: compileExample returns an error result for unknown names", () => {
    const r = compileExample("does-not-exist.kumiki");
    expect(r).toEqual({ kind: "err", message: "unknown example: does-not-exist.kumiki" });
  });
});
