import { codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

const COMPLETE = `slot n : Int = 0
tile App = column(text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

const NO_APP = `slot n : Int = 0
tile App = column(text(n.show))
`;

const TWO_APPS = `slot n : Int = 0
tile App   = column(text(n.show))
tile Other = column(text("x"))
app First  caps=[] routes={"/" -> App,    "/404" -> App}   init=[]
app Second caps=[] routes={"/x" -> Other, "/404" -> Other} init=[]
`;

describe("E0003 missing-app", () => {
  it("reports a program that declares definitions but no entry point", () => {
    expect(checkSource(NO_APP)).toEqual([
      {
        code: "E0003",
        kind: "missing-app",
        message: "Program has no app definition",
        pos: { line: 1, col: 1 },
      },
    ]);
  });

  it("reports an empty file", () => {
    expect(checkSource("").map((e) => e.code)).toEqual(["E0003"]);
  });

  it("reports a file that is only whitespace and comments", () => {
    expect(checkSource("\n   \n# nothing here\n\n").map((e) => e.code)).toEqual(["E0003"]);
  });

  it("says nothing about a program that has an app", () => {
    expect(checkSource(COMPLETE)).toEqual([]);
  });

  describe("requireApp: false — a program under construction", () => {
    it("suppresses E0003", () => {
      expect(checkSource(NO_APP, { requireApp: false })).toEqual([]);
    });

    it("leaves every other diagnostic in place", () => {
      const src = `slot n : Int = 0
tile App = column(text(missing.show))
`;
      const codes = checkSource(src, { requireApp: false }).map((e) => e.code);
      expect(codes).toContain("E0103");
      expect(codes).not.toContain("E0003");
    });

    it("still reports E0004 — one app too many is not an unfinished program", () => {
      expect(checkSource(TWO_APPS, { requireApp: false }).map((e) => e.code)).toEqual(["E0004"]);
    });
  });
});

describe("E0004 duplicate-app", () => {
  it("names each app past the first, at its own definition", () => {
    expect(checkSource(TWO_APPS)).toEqual([
      {
        code: "E0004",
        kind: "duplicate-app",
        message: 'Program declares more than one app definition ("Second")',
        pos: { line: 5, col: 1 },
      },
    ]);
  });

  it("reports every extra, not just the second", () => {
    const src = `${TWO_APPS}app Third caps=[] routes={"/y" -> Other, "/404" -> Other} init=[]
`;
    expect(checkSource(src).map((e) => `${e.code}@${e.pos.line}`)).toEqual(["E0004@5", "E0004@6"]);
  });

  it("says nothing about a program with exactly one app", () => {
    expect(checkSource(COMPLETE)).toEqual([]);
  });
});

describe("check and build agree on what is buildable", () => {
  it("compile() reports the diagnostic instead of throwing out of codegen", () => {
    const result = compile(NO_APP, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0003"]);
  });

  it("codegen still refuses an app-less program when called directly", () => {
    expect(() => codegen(parse(lex(NO_APP)), { runtimeSpecifier: "./runtime.js" })).toThrow(
      "No app definition found",
    );
  });

  it("compile() refuses two apps rather than emitting one of them", () => {
    const result = compile(TWO_APPS, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.errors.map((e) => e.code)).toEqual(["E0004"]);
    // Codegen alone still takes the last app's routes.
    const emitted = codegen(parse(lex(TWO_APPS)), { runtimeSpecifier: "./runtime.js" }).js;
    expect(emitted).toContain('"/404"');
    expect(emitted).not.toContain('"/x"');
  });
});
