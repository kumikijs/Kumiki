// A bind list names the payload's positionals in order, so two binds naming
// the same thing is not an abbreviation for anything: codegen emits one `const`
// per bind, the reducer body declared the name twice, and the whole module
// threw `SyntaxError: Identifier 'dup' has already been declared` at load —
// with `check` and `build` clean.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, compile, lex, parse } from "@kumikijs/compiler";
import { afterAll, describe, expect, it } from "vitest";

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

/** The text at a diagnostic's own position, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

/** A program with one effect-event reducer under test. `binds` is the whole list. */
function app(binds: string, body = 'seen := "x"'): string {
  return `slot seen : Text = ""

effect ping cap=log.write
            in=Unit
            out=Result(Text, Text)
            map-request={level: "info", message: "p"}

reducer pinged
    on=ping.ok(${binds})
    do= ${body}

tile App = column(text(seen))

app A
    caps   = [log.write]
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
}

describe("a bind list's names are distinct", () => {
  it("refuses a name written twice", () => {
    expect(codes(app("dup, dup"))).toEqual(["E0123"]);
  });

  it("reports at the second bind", () => {
    const src = app("dup, dup");
    const d = diagnose(src)[0];
    // The first `dup` is followed by a comma; the reported one closes the list.
    expect(d && textAt(src, d)).toBe("dup)");
  });

  it("names the positional it takes and the one it leaves unreadable", () => {
    expect(diagnose(app("dup, dup"))[0]?.message).toBe(
      '"dup" is bound twice in this trigger: it names $1 and then $2, so the two binds are ' +
        "peers — nothing nests them, the second does not shadow the first, and $1 has no name " +
        'left to read it by. Rename one, or write "_" for a positional the reducer does not read',
    );
  });

  it("exempts _ however often it is written", () => {
    expect(diagnose(app("_, _, _"))).toEqual([]);
  });

  it("counts a _ as a position all the same", () => {
    // `on=ping.ok(_, keep)` lowers to `keep = _payload["$2"]`, so the index a
    // duplicate names is its place in the list, wildcards included.
    expect(diagnose(app("_, x, x"))[0]?.message).toContain("it names $2 and then $3");
  });

  it("reports once per repeat past the first", () => {
    const src = app("x, x, x");
    expect(codes(src)).toEqual(["E0123", "E0123"]);
    // Both anchor on the first occurrence, which is the one that stays.
    expect(diagnose(src).map((d) => /names \$\d+ and then \$\d+/.exec(d.message)?.[0])).toEqual([
      "names $1 and then $2",
      "names $1 and then $3",
    ]);
  });

  it("leaves a repeated reserved name to E0121 alone", () => {
    // Both reports already say to rename the bind, and doing that removes the
    // duplicate too — a third report would repeat one mistake, not name two.
    expect(codes(app("$el, $el"))).toEqual(["E0121", "E0121"]);
  });

  it("counts the position a reserved bind holds, and does not count its name", () => {
    // `$el` takes the E0121 path and never records a position of its own, so
    // the repeat of `x` still names the place `$el` occupies between them.
    const src = app("x, $el, x");
    expect(codes(src)).toEqual(["E0121", "E0123"]);
    expect(diagnose(src)[1]?.message).toContain("it names $1 and then $3");
  });

  it("says nothing about a list of distinct names", () => {
    expect(diagnose(app("first, second"))).toEqual([]);
  });

  it("keeps the duplicate in scope, so the body's reads do not cascade", () => {
    // Without this the body would collect an E0103 per read, on top of a
    // report that already says what is wrong.
    expect(codes(app("dup, dup", "seen := dup"))).toEqual(["E0123"]);
  });
});

// The half `check` cannot answer. `compile` decides failure by severity
// (`compile.ts`), so a regression that marked E0123 a warning would leave every
// assertion above green and ship the module that cannot load — which is the bug
// itself, back again. And the positional the message names is `typecheck.ts`'s
// index while the one the payload is read at is `emit-reducer.ts`'s: two
// expressions with nothing between them, so the agreement is asserted here or
// nowhere.
describe("the emitted module for a bind list", () => {
  const RUNTIME = { runtimeSpecifier: "@kumikijs/runtime", exportApp: true } as const;
  const TMP_ROOT = resolve(__dirname, "test-tmp");
  mkdirSync(TMP_ROOT, { recursive: true });
  const made: string[] = [];
  // Removed whatever the outcome: these directories accumulate otherwise, and
  // enough of them time out the module-load tests in this package.
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  type ReducerShape = {
    name: string;
    apply: (
      live: Record<string, unknown>,
      payload: Record<string, unknown>,
    ) => { slots: Record<string, unknown> };
  };

  /** Compile, write the module out and `import()` it, then apply `pinged`. */
  async function seenAfter(source: string, payload: Record<string, unknown>): Promise<unknown> {
    const result = compile(source, RUNTIME);
    if (result.kind !== "ok")
      expect.fail(result.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
    const dir = mkdtempSync(join(TMP_ROOT, "effect-bind-"));
    made.push(dir);
    const file = join(dir, "app.mjs");
    writeFileSync(file, result.js);
    const mod: { createApp: () => { reducers: ReducerShape[] } } = await import(
      `${pathToFileURL(file).href}?t=${Date.now()}`
    );
    const reducer = mod.createApp().reducers.find((r) => r.name === "pinged");
    if (!reducer) expect.fail("the compiled module has no reducer named pinged");
    return reducer.apply({ seen: "" }, payload).slots.seen;
  }

  // A real module load overruns the 5s default on a cold cache.
  const LOADS = { timeout: 30_000 } as const;

  it("is not emitted at all for a duplicate", () => {
    // `compile`, not `check`: E0123 marked a warning would pass every case
    // above and still reach codegen.
    expect(compile(app("dup, dup"), RUNTIME).kind).toBe("fail");
  });

  it("reads the positional the diagnostic counts to", LOADS, async () => {
    // `_` occupies `$1`, so `keep` is the payload's `$2` — the same index
    // E0123 names when a repeat lands there.
    expect(await seenAfter(app("_, keep", "seen := keep"), { $1: "a", $2: "b" })).toBe("b");
  });

  it("loads with a list of distinct names", LOADS, async () => {
    expect(await seenAfter(app("first, second", "seen := second"), { $1: "a", $2: "b" })).toBe("b");
  });
});
