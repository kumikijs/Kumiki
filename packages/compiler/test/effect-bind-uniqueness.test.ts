// A bind list names the payload's positionals in order, so two binds naming
// the same thing is not an abbreviation for anything: codegen emits one `const`
// per bind, the reducer body declared the name twice, and the whole module
// threw `SyntaxError: Identifier 'dup' has already been declared` at load —
// with `check` and `build` clean.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
