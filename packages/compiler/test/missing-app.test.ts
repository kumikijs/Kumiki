// A program with no `app` definition has no entry point: `codegen` cannot
// pick a root tile or a route table, so it throws. That throw is not a
// diagnostic, which used to mean `check()` — the gate every tool and CI job
// points at — reported `ok` for a file nothing could build. E0003 closes the
// gap; these tests pin both the diagnostic and the incremental-editing escape
// hatch that keeps `kumiki add` usable on a half-written program.

import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const COMPLETE = `slot n : Int = 0
tile App = column(text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const NO_APP = `slot n : Int = 0
tile App = column(text(n.show))
`;

const checkSrc = (src: string, opts?: Parameters<typeof check>[1]) => check(parse(lex(src)), opts);

describe("E0003 missing-app", () => {
  it("reports a program that declares definitions but no entry point", () => {
    expect(checkSrc(NO_APP)).toEqual([
      {
        code: "E0003",
        kind: "missing-app",
        message: "Program has no app definition",
        pos: { line: 1, col: 1 },
      },
    ]);
  });

  it("reports an empty file", () => {
    expect(checkSrc("").map((e) => e.code)).toEqual(["E0003"]);
  });

  it("reports a file that is only whitespace and comments", () => {
    expect(checkSrc("\n   \n# nothing here\n\n").map((e) => e.code)).toEqual(["E0003"]);
  });

  it("says nothing about a program that has an app", () => {
    expect(checkSrc(COMPLETE)).toEqual([]);
  });

  describe("requireApp: false — a program under construction", () => {
    it("suppresses E0003", () => {
      expect(checkSrc(NO_APP, { requireApp: false })).toEqual([]);
    });

    it("leaves every other diagnostic in place", () => {
      const src = `slot n : Int = 0
tile App = column(text(missing.show))
`;
      const codes = checkSrc(src, { requireApp: false }).map((e) => e.code);
      expect(codes).toContain("E0103");
      expect(codes).not.toContain("E0003");
    });
  });
});

describe("check and build agree on what is buildable", () => {
  it("compile() reports the diagnostic instead of throwing out of codegen", () => {
    const result = compile(NO_APP, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0003"]);
  });

  // The throw stays as a contract violation for callers that reach codegen
  // without going through check() at all — it is no longer how the CLI or the
  // Vite plugin learn that an app is missing.
  it("codegen still refuses an app-less program when called directly", () => {
    expect(() => codegen(parse(lex(NO_APP)), { runtimeSpecifier: "./runtime.js" })).toThrow(
      "No app definition found",
    );
  });
});
