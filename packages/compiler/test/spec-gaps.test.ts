import { compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function check(src: string): ReturnType<typeof compile> {
  return compile(src, { runtimeSpecifier: "./runtime.js" });
}

describe("spec gaps", () => {
  it("Gap 1 — literal match patterns are a parse error", () => {
    const src = [
      'slot status : Text = "open"',
      "fn label(s: Text) -> Text = match s with",
      '  | "open" -> "Open"',
      '  | "closed" -> "Closed"',
      "tile App = text(label(status))",
      "app T",
      "    caps = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init = []",
    ].join("\n");
    // A string-literal pattern is not in the pattern grammar; parsing must fail.
    expect(() => parse(lex(src))).toThrow();
  });

  it("Gap 2 — `$1` in a tile with no `in=` is E0103 with an in= hint", () => {
    const src = [
      "slot items : List(Text) = []",
      "tile Row = card(text($1))",
      "tile App = column(for x in items Row())",
      "app T",
      "    caps = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init = []",
    ].join("\n");
    const result = check(src);
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    const e = result.errors.find((x) => x.code === "E0103");
    expect(e).toBeDefined();
    expect(e?.message).toContain("in=");
  });

  it("Gap 3 — a tile call inside the props block is a parse error", () => {
    const src = [
      'tile App = link(to="/x") {text("Home")}',
      "app T",
      "    caps = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init = []",
    ].join("\n");
    // `{...}` is `key: value` props only — a bare tile call inside it can't parse.
    expect(() => parse(lex(src))).toThrow();
  });

  it("Gap 3 — the canonical `link(text=…)` argument form compiles", () => {
    const src = [
      'tile App = link(to="/x", text="Home")',
      "app T",
      "    caps = []",
      '    routes = {"/" -> App, "/404" -> App}',
      "    init = []",
    ].join("\n");
    const result = check(src);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.js).toContain('"link"');
  });
});
