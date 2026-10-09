// routing.md §3.1.3: `/404` is the fallback for paths no route matches, and the
// fallback renders a tile. A redirect written at `/404` is E0001 with the kind
// `404-is-redirect`, reported at the redirect. It is not `missing-404`: the map
// has a `/404` entry, and adding the one `missing-404` asks for writes the
// pattern twice (E0008).
//
// A `sub-routes` map has no `/404` of its own: no sub-route is matched at
// `/404`, so a `/404` redirect there never runs, and takes the same kind.

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

const SUB_REDIRECT =
  'Sub-route "/404" in tile "Settings" is a redirect that never runs — no sub-route is ' +
  'matched at "/404", which is the app\'s fallback. Remove it: a child path that no ' +
  "sub-route matches renders the parent's default sub-route, or else the app's \"/404\"";

describe('a redirect at "/404" in a sub-routes map', () => {
  it("is reported, at the sub-route", () => {
    const src = app(
      '{"/" -> Home, "/settings/*" -> Settings, "/404" -> NotFound}',
      LAYOUT('{"/settings" -> Home, "/404" ->> "/"}'),
    );
    const diagnostics = diagnose(src);
    expect(diagnostics).toMatchObject([
      { code: "E0001", kind: "404-is-redirect", message: SUB_REDIRECT },
    ]);
    const [d] = diagnostics;
    expect(d && textAt(src, d)).toMatch(/^"\/404" ->> "\/"\}/);
  });

  it("is reported beside the app's own missing /404, which keeps its kind", () => {
    const src = app(
      '{"/" -> Home, "/settings/*" -> Settings}',
      LAYOUT('{"/settings" -> Home, "/404" ->> "/"}'),
    );
    expect(diagnose(src).map((d) => [d.code, d.kind, d.line])).toEqual([
      ["E0001", "404-is-redirect", 3],
      ["E0001", "missing-404", 4],
    ]);
  });
});
