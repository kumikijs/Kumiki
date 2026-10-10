import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { jsBinding } from "../src/codegen/context.ts";
import { RESERVED_BIND_NAMES } from "../src/reserved-binds.ts";
import { codesOf, locatedOf, posOf } from "./helpers/diagnostics.ts";
import { importModule, LOADABLE, type ReducerShape } from "./helpers/module.ts";

function program(binds: string, body: string, outcome: "ok" | "err" = "ok"): string {
  return `slot seen : Text = ""

effect ping cap=log.write
            in=Unit
            out=Result(Text, Text)
            map-request={level: "info", message: "ping"}

reducer subject
    on=ping.${outcome}(${binds})
    do= ${body}

tile Page = column(text(seen))

app A
    caps   = [log.write]
    routes = {"/" -> Page, "/404" -> Page}
    init   = []
`;
}

describe("an effect bind named after a positional binding", () => {
  for (const name of RESERVED_BIND_NAMES.keys()) {
    it(`is E0121 at the bind for ${name}`, () => {
      const src = program(`${name}, _`, `seen := ${name}`);
      const found = locatedOf(src);
      expect(found.map((e) => e.code)).toEqual(["E0121"]);
      expect({ line: found[0]?.line, col: found[0]?.col }).toEqual(posOf(src, name));
      expect(found[0]?.message).toContain(`"${name}"`);
    });
  }

  it("reads the same on an `.err` trigger", () => {
    expect(codesOf(program("$event", "seen := $event", "err"))).toEqual(["E0121"]);
  });

  it("reaches a bind past the second position", () => {
    const src = program("a, b, $el", 'seen := "x"');
    const found = locatedOf(src);
    expect(found.map((e) => e.code)).toEqual(["E0121"]);
    expect({ line: found[0]?.line, col: found[0]?.col }).toEqual(posOf(src, "$el"));
  });

  it("does not also report E0119 for $route", () => {
    expect(codesOf(program("$route, _", "seen := $route"))).toEqual(["E0121"]);
  });

  it("reports one per offending bind, each at its own position", () => {
    const src = program("$el, $event", 'seen := "x"');
    const found = locatedOf(src);
    expect(found.map((e) => e.code)).toEqual(["E0121", "E0121"]);
    expect(found.map((e) => ({ line: e.line, col: e.col }))).toEqual([
      posOf(src, "$el"),
      posOf(src, "$event"),
    ]);
  });

  it("leaves every other bind alone, `$`-prefixed ones included", () => {
    expect(codesOf(program("_, _", 'seen := "x"'))).toEqual([]);
    expect(codesOf(program("$1, _", "seen := $1"))).toEqual([]);
    expect(codesOf(program("$m, _", "seen := $m"))).toEqual([]);
    expect(codesOf(program("$now, _", "seen := $now"))).toEqual([]);
  });
});

describe("the emitted module for ordinary binds", () => {
  it("declares every reserved binding exactly once and still loads", {
    timeout: 30_000,
  }, async () => {
    expect(compile(program("$el, _", 'seen := "x"'), LOADABLE).kind).toBe("fail");

    const result = compile(program("payload, _", "seen := payload"), LOADABLE);
    if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.code).join("\n"));

    for (const name of RESERVED_BIND_NAMES.keys()) {
      const decl = `const ${jsBinding(name)} =`;
      expect(result.js.split(decl).length - 1).toBe(1);
    }

    // A name declared twice makes this import throw at parse time.
    const mod = await importModule<{ createApp: () => { reducers: ReducerShape[] } }>(
      result.js,
      "reserved-bind",
    );
    const reducer = mod.createApp().reducers.find((r) => r.name === "subject");
    expect(reducer?.apply({ seen: "" }, { $1: "hello" }).slots).toEqual({ seen: "hello" });
  });
});
