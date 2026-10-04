// routing.md §3.10: a redirect's target names what its source binds, and a
// chain of redirects has to reach a page. Two things check can decide about
// that from the route table alone: a target that names a parameter (or the
// wildcard rest) its source does not bind (E0125), and a chain of redirects
// written for static paths that comes back to where it started (E0010). The
// runtime side — substitution, following the chain, stopping a loop no check
// can see — is pinned in packages/tests/redirect-chain.test.ts.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

type Diagnostic = { code: string; message: string; line: number; col: number };

function diagnose(source: string): Diagnostic[] {
  return check(parse(lex(source))).map((e) => ({
    code: e.code,
    message: e.message,
    line: e.pos.line,
    col: e.pos.col,
  }));
}

/** The text at a diagnostic's own line and column, so a position is read rather than counted. */
function textAt(source: string, at: { line: number; col: number }): string {
  return (source.split("\n")[at.line - 1] ?? "").slice(at.col - 1);
}

const PAGES = `tile Home = page(heading("home"))
tile Item = page(heading("item"))
tile NotFound = page(heading("404"))`;

/** A program whose app routes are `entries`, around a page at `/` and the 404 entry. */
function app(entries: string, defs = PAGES): string {
  return `${defs}
app M
    caps   = []
    routes = {
        "/" -> Home,
        ${entries},
        "/404" -> NotFound
    }
    init   = []`;
}

/** A program whose `/s/*` parent declares `children` as its sub-routes. */
function nested(children: string, entries = '"/items/:id" -> Item'): string {
  return app(
    `"/s/*" -> Layout, ${entries}`,
    `${PAGES}
tile SHome = page(heading("section home"))
tile Layout
    sub-routes = {
        ${children},
        "/s" -> SHome
    }
    = page(route-outlet())`,
  );
}

describe("E0125: a redirect target names only what its source binds", () => {
  it("accepts a parameter the source binds", () => {
    expect(diagnose(app('"/old/:id" ->> "/items/:id", "/items/:id" -> Item'))).toEqual([]);
  });

  it("accepts a parameter the source binds at another position", () => {
    expect(diagnose(app('"/u/:id/edit" ->> "/items/:id", "/items/:id" -> Item'))).toEqual([]);
  });

  it("accepts a wildcard rest the source binds", () => {
    expect(diagnose(app('"/docs/*" ->> "/help/*", "/help/*" -> Item'))).toEqual([]);
  });

  it("accepts a wildcard source whose target drops the rest", () => {
    expect(diagnose(app('"/docs/*" ->> "/"'))).toEqual([]);
  });

  it("reports a target parameter the source does not bind, at the redirect entry", () => {
    const src = app('"/old/:id" ->> "/items/:key", "/items/:key" -> Item');
    const found = diagnose(src);
    expect(found.map((d) => [d.code, d.message])).toEqual([
      [
        "E0125",
        'Redirect "/old/:id" ->> "/items/:key" names ":key", which "/old/:id" does not bind',
      ],
    ]);
    const [d] = found;
    expect(d && textAt(src, d)).toMatch(/^"\/old\/:id" ->>/);
  });

  it("reports a parameter written into the target of a static source", () => {
    expect(
      diagnose(app('"/old" ->> "/items/:id", "/items/:id" -> Item')).map((d) => d.code),
    ).toEqual(["E0125"]);
  });

  it("reports a wildcard in the target of a source that has none", () => {
    expect(
      diagnose(app('"/old/:id" ->> "/help/*", "/help/*" -> Item')).map((d) => d.message),
    ).toEqual(['Redirect "/old/:id" ->> "/help/*" names "*", which "/old/:id" does not bind']);
  });

  it("reports a parameter written after the source's wildcard, which binds nothing", () => {
    // The wildcard takes the rest of the path, so `:id` has no segment to match.
    expect(
      diagnose(app('"/a/*/:id" ->> "/b/:id", "/b/:id" -> Item')).map((d) => d.message),
    ).toEqual(['Redirect "/a/*/:id" ->> "/b/:id" names ":id", which "/a/*/:id" does not bind']);
  });

  it("reports each unbound name once", () => {
    expect(
      diagnose(app('"/old" ->> "/:a/:b/:a", "/:a/:b/:c" -> Item')).map((d) => d.message),
    ).toEqual([
      'Redirect "/old" ->> "/:a/:b/:a" names ":a", which "/old" does not bind',
      'Redirect "/old" ->> "/:a/:b/:a" names ":b", which "/old" does not bind',
    ]);
  });

  it("reports a sub-route redirect the same way, at its entry", () => {
    const src = nested('"/s/u/:uid" ->> "/s/users/:id"');
    const found = diagnose(src);
    expect(found.map((d) => d.message)).toEqual([
      'Redirect "/s/u/:uid" ->> "/s/users/:id" names ":id", which "/s/u/:uid" does not bind',
    ]);
    const [d] = found;
    expect(d && textAt(src, d)).toMatch(/^"\/s\/u\/:uid" ->>/);
  });

  it("accepts a sub-route redirect whose target names what its source binds", () => {
    expect(diagnose(nested('"/s/u/:uid" ->> "/items/:uid"'))).toEqual([]);
  });
});

describe("E0010: a chain of static redirects reaches a page", () => {
  it("accepts a chain that ends on a page", () => {
    expect(diagnose(app('"/v1" ->> "/v2", "/v2" ->> "/"'))).toEqual([]);
  });

  it("reports two redirects that send a path back and forth, once, at the first", () => {
    const src = app('"/a" ->> "/b", "/b" ->> "/a"');
    const found = diagnose(src);
    expect(found.map((d) => [d.code, d.message])).toEqual([
      ["E0010", 'Redirect "/a" comes back to itself (/a ->> /b ->> /a)'],
    ]);
    const [d] = found;
    expect(d && textAt(src, d)).toMatch(/^"\/a" ->> "\/b"/);
  });

  it("names the cycle from the entry declared first, whichever one it enters by", () => {
    // `/start` leads into the loop without being part of it.
    expect(
      diagnose(app('"/start" ->> "/c", "/a" ->> "/b", "/b" ->> "/c", "/c" ->> "/a"')).map(
        (d) => d.message,
      ),
    ).toEqual(['Redirect "/a" comes back to itself (/a ->> /b ->> /c ->> /a)']);
  });

  it("reports a redirect to its own path", () => {
    expect(diagnose(app('"/a" ->> "/a"')).map((d) => d.message)).toEqual([
      'Redirect "/a" comes back to itself (/a ->> /a)',
    ]);
  });

  it("reports each cycle of one table", () => {
    expect(
      diagnose(app('"/a" ->> "/b", "/b" ->> "/a", "/x" ->> "/x"')).map((d) => d.message),
    ).toEqual([
      'Redirect "/a" comes back to itself (/a ->> /b ->> /a)',
      'Redirect "/x" comes back to itself (/x ->> /x)',
    ]);
  });

  it("reports a cycle inside a sub-routes map", () => {
    const src = nested('"/s/a" ->> "/s/b", "/s/b" ->> "/s/a"');
    const found = diagnose(src);
    expect(found.map((d) => [d.code, d.message])).toEqual([
      ["E0010", 'Redirect "/s/a" comes back to itself (/s/a ->> /s/b ->> /s/a)'],
    ]);
    const [d] = found;
    expect(d && textAt(src, d)).toMatch(/^"\/s\/a" ->>/);
  });

  it("accepts a chain inside a sub-routes map that ends on a child", () => {
    expect(diagnose(nested('"/s/a" ->> "/s/b", "/s/b" ->> "/s"'))).toEqual([]);
  });

  it("follows a path to the entry declared first for it, as the runtime does", () => {
    // `/b` is declared twice (E0008); the page declared first owns it, so `/a`
    // lands there and the second `/b` entry never redirects.
    expect(diagnose(app('"/b" -> Item, "/a" ->> "/b", "/b" ->> "/a"')).map((d) => d.code)).toEqual([
      "E0008",
    ]);
  });

  it("leaves a loop through a parameter to the runtime", () => {
    // `/p/1` and `/q/1` send each other back and forth for every value of
    // `:x`, but which path a parameter route owns is a question about a URL.
    expect(diagnose(app('"/p/:x" ->> "/q/:x", "/q/:x" ->> "/p/:x"'))).toEqual([]);
  });

  it("does not follow a redirect written at /404, which never owns a path", () => {
    // The `/404` entry is the fallback, never matched: E0001 reports that it
    // renders nothing, and nothing loops through it.
    const src = `${PAGES}
app M
    caps   = []
    routes = {"/" -> Home, "/a" ->> "/404", "/404" ->> "/a"}
    init   = []`;
    expect(diagnose(src).map((d) => d.code)).toEqual(["E0001"]);
  });
});
