// Codegen declares `$el`, `$event` and `$route` in every reducer body, seeded
// from whatever the trigger's payload carries — an effect-event payload is
// `{$1, $2}` and carries none of them. An effect-event bind that took one of
// those names was a second declaration of it, so the whole module threw
// `SyntaxError` before a line of it ran, with `check` and `build` both clean.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { jsBinding } from "../src/codegen/context.ts";
import { RESERVED_BIND_NAMES } from "../src/reserved-binds.ts";

const RUNTIME = { runtimeSpecifier: "@kumikijs/runtime", exportApp: true } as const;

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

/**
 * A program whose one reducer waits on an effect. `binds` is the whole bind
 * list, `body` the whole `do=` clause.
 */
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

function diagnose(source: string): { code: string; message: string; line: number; col: number }[] {
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

function codes(source: string): string[] {
  return diagnose(source).map((e) => e.code);
}

/** Where `needle` first occurs, in the 1-based line/col the diagnostics use. */
function posOf(source: string, needle: string): { line: number; col: number } {
  const idx = source.indexOf(needle);
  const before = source.slice(0, idx);
  return { line: before.split("\n").length, col: idx - before.lastIndexOf("\n") };
}

describe("an effect bind named after a positional binding", () => {
  for (const name of RESERVED_BIND_NAMES.keys()) {
    it(`is E0121 at the bind for ${name}`, () => {
      const src = program(`${name}, _`, `seen := ${name}`);
      const found = diagnose(src);
      expect(found.map((e) => e.code)).toEqual(["E0121"]);
      // At the bind, not at the effect name and not at the body's read: the
      // name is the thing that is wrong, wherever it is later used.
      expect({ line: found[0]?.line, col: found[0]?.col }).toEqual(posOf(src, name));
      expect(found[0]?.message).toContain(`"${name}"`);
    });
  }

  it("reads the same on an `.err` trigger", () => {
    expect(codes(program("$event", "seen := $event", "err"))).toEqual(["E0121"]);
  });

  it("reaches a bind past the second position", () => {
    const src = program("a, b, $el", 'seen := "x"');
    const found = diagnose(src);
    expect(found.map((e) => e.code)).toEqual(["E0121"]);
    expect({ line: found[0]?.line, col: found[0]?.col }).toEqual(posOf(src, "$el"));
  });

  it("does not also report E0119 for $route", () => {
    // The bind still enters the local scope, so the body's `$route` is that
    // binding rather than a payload read out of its trigger's scope. Reporting
    // both would send the author to the `route` slot for a name they chose.
    expect(codes(program("$route, _", "seen := $route"))).toEqual(["E0121"]);
  });

  it("reports one per offending bind, each at its own position", () => {
    const src = program("$el, $event", 'seen := "x"');
    const found = diagnose(src);
    expect(found.map((e) => e.code)).toEqual(["E0121", "E0121"]);
    expect(found.map((e) => ({ line: e.line, col: e.col }))).toEqual([
      posOf(src, "$el"),
      posOf(src, "$event"),
    ]);
  });

  it("leaves every other bind alone, `$`-prefixed ones included", () => {
    // Three names are reserved, not a prefix: the example corpus binds effect
    // payloads as `$m` / `$p` / `$id` throughout, and `$1` is the payload's own.
    expect(codes(program("_, _", 'seen := "x"'))).toEqual([]);
    expect(codes(program("$1, _", "seen := $1"))).toEqual([]);
    expect(codes(program("$m, _", "seen := $m"))).toEqual([]);
    expect(codes(program("$now, _", "seen := $now"))).toEqual([]);
  });
});

describe("the emitted module for ordinary binds", () => {
  // Writes the generated module to disk and `import()`s it, so it pays for a
  // real module load and overruns the 5s default on a cold cache. Per-test,
  // because the default is an assertion elsewhere in this package.
  it("declares every reserved binding exactly once and still loads", {
    timeout: 30_000,
  }, async () => {
    // `compile`, not `check`: a regression that marked E0121 a warning would
    // leave every assertion above green and ship the module that cannot load.
    expect(compile(program("$el, _", 'seen := "x"'), RUNTIME).kind).toBe("fail");

    const result = compile(program("payload, _", "seen := payload"), RUNTIME);
    if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.code).join("\n"));

    for (const name of RESERVED_BIND_NAMES.keys()) {
      const decl = `const ${jsBinding(name)} =`;
      expect(result.js.split(decl).length - 1).toBe(1);
    }

    const dir = mkdtempSync(join(TMP_ROOT, "reserved-bind-"));
    const file = join(dir, "app.mjs");
    writeFileSync(file, result.js);
    // A name declared twice makes this import throw at parse time.
    const mod: {
      createApp: () => {
        reducers: {
          name: string;
          apply: (
            live: Record<string, unknown>,
            payload: Record<string, unknown>,
          ) => { slots: Record<string, unknown> };
        }[];
      };
    } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);

    const reducer = mod.createApp().reducers.find((r) => r.name === "subject");
    expect(reducer?.apply({ seen: "" }, { $1: "hello" }).slots).toEqual({ seen: "hello" });
  });
});
