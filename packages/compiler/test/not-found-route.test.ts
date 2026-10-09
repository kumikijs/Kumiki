// routing.md §3.1.3: `/404` is the fallback for paths no route matches, and the
// fallback renders a tile. A redirect written at `/404` is E0001 with the kind
// `404-is-redirect`, reported at the redirect. It is not `missing-404`: the map
// has a `/404` entry, and adding the one `missing-404` asks for writes the
// pattern twice (E0008).
//
// A `sub-routes` map has no `/404` of its own: `/404` is reserved for the app's
// fallback, and no sub-route is matched against it. An entry written there is
// E0001 `404-in-sub-routes`, whether it names a tile or redirects — dead either
// way, so the one report for it.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

type Diagnostic = { code: string; kind: string; message: string; line: number; col: number };

function diagnose(source: string): Diagnostic[] {
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    kind: e.kind,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

/** The text at a diagnostic's own line and column, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

const TILES = `tile Home     = column(text("h"))
tile NotFound = column(text("nf"))`;

/** A program whose whole `routes` map is under test. */
function app(routes: string, defs = TILES): string {
  return `${defs}
app M caps=[] routes=${routes} init=[]`;
}

const APP_REDIRECT =
  'Route "/404" is a redirect, but "/404" is the fallback for paths no route matches ' +
  'and has to render a tile — write "/404" -> <Tile>';

describe('a redirect at "/404" in app.routes', () => {
  it("is reported as a redirect, not as a missing /404", () => {
    expect(diagnose(app('{"/" -> Home, "/404" ->> "/"}'))).toMatchObject([
      { code: "E0001", kind: "404-is-redirect", message: APP_REDIRECT },
    ]);
  });

  it("is reported at the redirect, not at the app", () => {
    const src = app('{"/" -> Home, "/404" ->> "/"}');
    const [d] = diagnose(src);
    expect(d && textAt(src, d)).toMatch(/^"\/404" ->> "\/"\}/);
  });

  it("is reported the same whatever path it redirects to", () => {
    for (const target of ['"/"', '"/home"', '"/nowhere"']) {
      expect(diagnose(app(`{"/" -> Home, "/404" ->> ${target}}`))).toMatchObject([
        { code: "E0001", kind: "404-is-redirect", message: APP_REDIRECT },
      ]);
    }
  });

  it("is a duplicate pattern beside a /404 that renders a tile, in either order", () => {
    // The tile serves the fallback, so E0001 has nothing to report; the second
    // `/404` is E0008's, wherever the redirect is written.
    for (const routes of [
      '{"/" -> Home, "/404" ->> "/", "/404" -> NotFound}',
      '{"/" -> Home, "/404" -> NotFound, "/404" ->> "/"}',
    ]) {
      expect(diagnose(app(routes)).map((d) => d.code)).toEqual(["E0008"]);
    }
  });

  it("leaves missing-404 to routes with no /404 entry at all", () => {
    expect(diagnose(app('{"/" -> Home, "/home" ->> "/"}'))).toMatchObject([
      { code: "E0001", kind: "missing-404", message: 'app.routes must include a "/404" entry' },
    ]);
  });
});

const LAYOUT = (subRoutes: string) => `${TILES}
tile Settings sub-routes=${subRoutes} = column(route-outlet())`;

const IN_SUB_ROUTES =
  'Tile "Settings" has a sub-route at "/404", which is reserved for the app\'s fallback — ' +
  "no sub-route is matched against it. Remove it: a child path that no sub-route matches " +
  "renders the sub-route tile at the parent's own path if there is one, or else the app's " +
  '"/404"';

/** The app's routes, with a `/404` of its own, around a `Settings` layout. */
const WITH_404 = '{"/" -> Home, "/settings/*" -> Settings, "/404" -> NotFound}';

/** The two forms of a `/404` sub-route: one that names a tile, one that redirects. */
const FORMS = {
  tile: '"/404" -> NotFound',
  redirect: '"/404" ->> "/"',
};

describe('an entry at "/404" in a sub-routes map', () => {
  for (const [form, entry] of Object.entries(FORMS)) {
    it(`is reported when it ${form === "tile" ? "names a tile" : "redirects"}, at the entry`, () => {
      const src = app(WITH_404, LAYOUT(`{"/settings" -> Home, ${entry}}`));
      const diagnostics = diagnose(src);
      expect(diagnostics).toMatchObject([
        { code: "E0001", kind: "404-in-sub-routes", message: IN_SUB_ROUTES },
      ]);
      const [d] = diagnostics;
      expect(d && textAt(src, d).startsWith(`${entry}}`)).toBe(true);
    });
  }

  it("is the entry's one report, so a target it names is not checked as well", () => {
    // `Ghost` is no tile, and `Panel` takes an input: E0105 and E0213 at any
    // other sub-route. Removing the entry is the repair for all of it.
    const defs = `${TILES}
tile Panel in=Text = column(text($1))
tile Settings sub-routes=`;
    for (const target of ["Ghost", "Panel"]) {
      const src = app(
        WITH_404,
        `${defs}{"/settings" -> Home, "/404" -> ${target}} = column(route-outlet())`,
      );
      expect(diagnose(src).map((d) => [d.code, d.kind])).toEqual([["E0001", "404-in-sub-routes"]]);
    }
  });

  it("is reported beside the app's own missing /404, which keeps its kind", () => {
    const src = app(
      '{"/" -> Home, "/settings/*" -> Settings}',
      LAYOUT('{"/settings" -> Home, "/404" ->> "/"}'),
    );
    expect(diagnose(src).map((d) => [d.code, d.kind, d.line])).toEqual([
      ["E0001", "404-in-sub-routes", 3],
      ["E0001", "missing-404", 4],
    ]);
  });
});
