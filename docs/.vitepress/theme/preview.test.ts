import { describe, expect, it } from "vitest";
import {
  buildSrcdoc,
  capabilities,
  compileExample,
  examples,
  PREVIEW_SANDBOX,
  previewDocument,
} from "./preview";

describe("preview pipeline", () => {
  it("loads the sorted example catalog and the capability manifest", () => {
    expect(examples.length).toBeGreaterThan(20);
    const names = examples.map((e) => e.name);
    expect([...names].sort()).toEqual(names);
    expect(names).toContain("19-effect-http.kumiki");
    expect(capabilities).toContain("telemetry.track");
  });

  it("buildSrcdoc embeds the app JS and every sandbox seam", () => {
    const srcdoc = buildSrcdoc("console.log('app-module-here')");
    expect(srcdoc).toContain("<script type=\"module\">console.log('app-module-here')");
    expect(srcdoc).toContain('router: "memory"');
    expect(srcdoc).toContain("/api/quote");
    expect(srcdoc).toContain("telemetry.track");
    expect(srcdoc).toContain("localStorage");
    // http.get must resolve asynchronously so Loading states actually paint
    expect(srcdoc).toMatch(/setTimeout\(\(\) => resolve\(response\), \d+\)/);
  });

  it("compileExample turns a committed example into a runnable srcdoc", () => {
    const r = compileExample("19-effect-http.kumiki");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.srcdoc).toContain('<script type="module">');
      expect(r.srcdoc).toContain("fetchQuote");
    }
  });

  it("compileExample returns an error result for unknown names", () => {
    const r = compileExample("does-not-exist.kumiki");
    expect(r).toEqual({ kind: "err", message: "unknown example: does-not-exist.kumiki" });
  });

  it("turns a source the compiler throws on into an error result", () => {
    const r = previewDocument("tile = = =");
    expect(r.kind).toBe("err");
    expect(r.kind === "err" && r.message).not.toBe("");
  });

  it("lets a preview run scripts and submit forms, and nothing else", () => {
    expect(PREVIEW_SANDBOX).toBe("allow-scripts allow-forms");
  });
});
