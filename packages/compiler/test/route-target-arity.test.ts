// A route entry applies the tile it names, and is the only application that
// cannot pass anything: the route table lowers to `tile: () => …`. A target
// that declared `in=` left `$1` unbound, so `check` and `build` both said ok
// and the mount died with `_d_1 is not defined` — nothing rendered at all.

import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
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
    expect(d && textAt(src, d)).toMatch(/^Panel\b/);
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
    const result = compile(app('{"/" -> Panel, "/404" -> Host}', TAKES_INPUT), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(result.kind).toBe("fail");
    expect(result.kind === "fail" && result.errors.map((e) => e.code)).toEqual(["E0213"]);
  });
});

// The refusal a caller reaching codegen without `check()` gets. Unreachable
// through `compile`, which is what the case above pins — so it is asserted
// where it does fire, or it would be asserted nowhere.
describe("codegen refuses the entry it cannot lower", () => {
  const lower = (src: string) => () =>
    codegen(parse(lex(src)), { runtimeSpecifier: "./runtime.js" });

  it("names the route entry", () => {
    expect(lower(app('{"/" -> Panel, "/404" -> Host}', TAKES_INPUT))).toThrow(
      'Route / targets tile "Panel", which declares in=',
    );
  });

  it("names the sub-route entry and its parent", () => {
    const src = app(
      '{"/" -> Home, "/s/*" -> Layout, "/404" -> Home}',
      `tile Panel in=Text = column(text($1))
tile Layout
    sub-routes = { "/s/child" -> Panel }
    = column(route-outlet())
tile Home = column(text("h"))`,
    );
    expect(lower(src)).toThrow('Sub-route /s/child in tile "Layout" targets tile "Panel"');
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
    expect(d && textAt(src, d)).toMatch(/^Panel\b/);
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

  it("leaves an undefined sub-route target to E0105 alone", () => {
    const src = app(ROUTES, NESTED.replace('"/s/child" -> Panel', '"/s/child" -> Missing'));
    expect(codes(src)).toEqual(["E0105"]);
  });

  it("reports a parent that declares in= once, at its route entry", () => {
    // The third `genRouteTile` site: a route target that carries sub-routes of
    // its own. The parent is refused; its children are read as usual.
    const src = app(
      '{"/" -> Home, "/s/*" -> Parent, "/404" -> Home}',
      `tile Child = column(text("c"))
tile Parent
    in=Text
    sub-routes = { "/s/child" -> Child }
    = column(text($1), route-outlet())
tile Home = column(text("h"))`,
    );
    expect(messages(src)).toEqual([`Route "/s/*" targets tile "Parent", which ${REFUSAL}`]);
  });

  it("reports an orphaned parent for both mistakes at once", () => {
    // `checkSubRoutes` runs for every tile, not only for reachable ones, so a
    // sub-route entry is answered for before anything routes to its parent.
    // Narrowing that later would take this report with it.
    const src = app(
      '{"/" -> Home, "/404" -> Home}',
      `tile Panel in=Text = column(text($1))
tile Layout
    sub-routes = { "/s/child" -> Panel }
    = column(route-outlet())
tile Home = column(text("h"))`,
    );
    expect(codes(src).sort()).toEqual(["E0111", "E0213"]);
  });
});
