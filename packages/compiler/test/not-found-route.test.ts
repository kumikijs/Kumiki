import { describe, expect, it } from "vitest";
import { checkSource, codesOf, textAt } from "./helpers/diagnostics.ts";

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
  it.each([
    '"/"',
    '"/home"',
    '"/nowhere"',
  ])("is reported as a redirect, not as a missing /404, whatever it redirects to (%s)", (target) => {
    expect(checkSource(app(`{"/" -> Home, "/404" ->> ${target}}`))).toMatchObject([
      { code: "E0001", kind: "404-is-redirect", message: APP_REDIRECT },
    ]);
  });

  it("is reported at the redirect, not at the app", () => {
    const src = app('{"/" -> Home, "/404" ->> "/"}');
    const [d] = checkSource(src);
    expect(d && textAt(src, d.pos)).toMatch(/^"\/404" ->> "\/"\}/);
  });

  it.each([
    '{"/" -> Home, "/404" ->> "/", "/404" -> NotFound}',
    '{"/" -> Home, "/404" -> NotFound, "/404" ->> "/"}',
  ])("is only a duplicate pattern beside a /404 that renders a tile: %s", (routes) => {
    expect(codesOf(app(routes))).toEqual(["E0008"]);
  });

  it("leaves missing-404 to routes with no /404 entry at all", () => {
    expect(checkSource(app('{"/" -> Home, "/home" ->> "/"}'))).toMatchObject([
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

describe('an entry at "/404" in a sub-routes map', () => {
  it.each([
    { form: "names a tile", entry: '"/404" -> NotFound' },
    { form: "redirects", entry: '"/404" ->> "/"' },
  ])("is reported at the entry when it $form", ({ entry }) => {
    const src = app(WITH_404, LAYOUT(`{"/settings" -> Home, ${entry}}`));
    const diagnostics = checkSource(src);
    expect(diagnostics).toMatchObject([
      { code: "E0001", kind: "404-in-sub-routes", message: IN_SUB_ROUTES },
    ]);
    const [d] = diagnostics;
    expect(d && textAt(src, d.pos).startsWith(`${entry}}`)).toBe(true);
  });

  // Elsewhere `Ghost` would be E0105 and `Panel`, which takes an input, E0213.
  it.each([
    "Ghost",
    "Panel",
  ])("is the entry's one report, so its target %s is not checked as well", (target) => {
    const src = app(
      WITH_404,
      `${TILES}
tile Panel in=Text = column(text($1))
tile Settings sub-routes={"/settings" -> Home, "/404" -> ${target}} = column(route-outlet())`,
    );
    expect(checkSource(src).map((d) => [d.code, d.kind])).toEqual([["E0001", "404-in-sub-routes"]]);
  });

  it("is reported beside the app's own missing /404, which keeps its kind", () => {
    const src = app(
      '{"/" -> Home, "/settings/*" -> Settings}',
      LAYOUT('{"/settings" -> Home, "/404" ->> "/"}'),
    );
    expect(checkSource(src).map((d) => [d.code, d.kind, d.pos.line])).toEqual([
      ["E0001", "404-in-sub-routes", 3],
      ["E0001", "missing-404", 4],
    ]);
  });
});
