// A route entry is a call site of the tile it names, and the only one that
// cannot pass an argument: the route table lowers to `tile: () => …`. A target
// that declared `in=` left `$1` unbound, so `check` and `build` both said ok
// and the mount died with `_d_1 is not defined` — nothing rendered at all.

import { check, compile, lex, parse } from "@kumikijs/compiler";
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

function messages(source: string): string[] {
  return diagnose(source)
    .map((e) => e.message)
    .sort();
}

/** The text at a diagnostic's own line and column, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

/** A program whose whole `routes` map is under test. */
function app(routes: string, defs: string): string {
  return `${defs}

app M
    caps   = []
    routes = ${routes}
    init   = []`;
}

const TAKES_INPUT = `tile Panel in=Text = column(text($1))
tile Host = column(Panel("a"))`;

const REFUSAL = "expects 1 argument(s) — a route target is rendered with none";

describe("a route target is rendered with no argument", () => {
  it("refuses a target that declares in=", () => {
    expect(codes(app('{"/" -> Panel, "/404" -> Host}', TAKES_INPUT))).toEqual(["E0213"]);
  });

  it("reports at the tile name in the entry, not at the app", () => {
    const src = app('{"/" -> Panel, "/404" -> Host}', TAKES_INPUT);
    const d = diagnose(src)[0];
    expect(d && textAt(src, d)).toMatch(/^Panel,/);
  });

  it("names the route and the tile", () => {
    expect(messages(app('{"/" -> Panel, "/404" -> Host}', TAKES_INPUT))).toEqual([
      `Route "/" targets tile "Panel", which ${REFUSAL}`,
    ]);
  });

  it("checks the /404 entry the same way", () => {
    expect(messages(app('{"/" -> Host, "/404" -> Panel}', TAKES_INPUT))).toEqual([
      `Route "/404" targets tile "Panel", which ${REFUSAL}`,
    ]);
  });

  it("accepts a target that declares none, and leaves it callable from a tile body", () => {
    // `Host` renders `Panel("a")`: only the route position is refused.
    expect(diagnose(app('{"/" -> Host, "/404" -> Host}', TAKES_INPUT))).toEqual([]);
  });

  it("says nothing about a redirect entry", () => {
    expect(diagnose(app('{"/" -> Host, "/old" ->> "/", "/404" -> Host}', TAKES_INPUT))).toEqual([]);
  });

  it("leaves an undefined target to E0105 alone", () => {
    expect(codes(app('{"/" -> Missing, "/404" -> Host}', TAKES_INPUT))).toEqual(["E0105"]);
  });

  it("answers with the diagnostic rather than output", () => {
    // `genRouteTile` throws on a target that declares `in=`; that it is never
    // reached is what this pins, since a throw carries no position.
    const result = compile(app('{"/" -> Panel, "/404" -> Host}', TAKES_INPUT), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.errors.map((e) => e.code)).toEqual(["E0213"]);
  });
});

describe("a sub-route target is rendered with no argument either", () => {
  // What `route-outlet` renders is a sub-route target, so the two are one rule.
  const NESTED = `tile Panel in=Text = column(text($1))
tile Child = column(text("c"))
tile Layout
    sub-routes = {
        "/s/child" -> Panel,
        "/s/other" -> Child
    }
    = column(route-outlet())
tile Home = column(text("h"))`;

  const ROUTES = '{"/" -> Home, "/s/*" -> Layout, "/404" -> Home}';

  it("refuses a sub-route target that declares in=", () => {
    expect(messages(app(ROUTES, NESTED))).toEqual([
      `Sub-route "/s/child" in tile "Layout" targets tile "Panel", which ${REFUSAL}`,
    ]);
  });

  it("reports at the sub-route entry", () => {
    const src = app(ROUTES, NESTED);
    const d = diagnose(src)[0];
    expect(d && textAt(src, d)).toMatch(/^Panel,/);
  });

  it("says nothing about a sub-route redirect", () => {
    const src = app(
      ROUTES,
      NESTED.replace('"/s/other" -> Child', '"/s/legacy" ->> "/s/child"').replace(
        '"/s/child" -> Panel',
        '"/s/child" -> Child',
      ),
    );
    expect(diagnose(src)).toEqual([]);
  });

  it("reports once per entry when a route and a sub-route name the same tile", () => {
    const src = app('{"/" -> Panel, "/s/*" -> Layout, "/404" -> Home}', NESTED);
    expect(messages(src)).toEqual([
      `Route "/" targets tile "Panel", which ${REFUSAL}`,
      `Sub-route "/s/child" in tile "Layout" targets tile "Panel", which ${REFUSAL}`,
    ]);
  });
});
