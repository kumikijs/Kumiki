import { renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { textAt } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

function appWith(entries: string): string {
  return `
tile Detail   = page(heading("Detail " + route.params.get-or("id", "?")))
tile NewTodo  = page(heading("New todo form"))
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app RouteOrder
    caps   = [nav.push]
    routes = {
        "/" -> Home,
        ${entries},
        "/404" -> NotFound
    }
    init   = []
`;
}

const PARAM_FIRST = appWith(`"/todos/:id" -> Detail, "/todos/new" -> NewTodo`);
const STATIC_FIRST = appWith(`"/todos/new" -> NewTodo, "/todos/:id" -> Detail`);

/** The page text each path renders, one memory-router mount per path. */
async function textsAt(src: string, ...paths: string[]): Promise<string[]> {
  const app = await loadSource(src, ["nav.push"]);
  return paths.map((path) => textAt(app, path));
}

describe("route match order", () => {
  it("a static segment outranks a parameter, whichever is declared first", async () => {
    for (const src of [PARAM_FIRST, STATIC_FIRST]) {
      const [fresh, existing] = await textsAt(src, "/todos/new", "/todos/42");
      expect(fresh).toContain("New todo form");
      expect(existing).toContain("Detail 42");
    }
  });

  it("ranks segment by segment, and keeps definition order between equals", async () => {
    const src = `
tile A        = page(heading("A " + route.params.get-or("x", "?")))
tile B        = page(heading("B " + route.params.get-or("y", "?")))
tile Deeper   = page(heading("Deeper " + route.params.get-or("z", "?")))
tile Deep     = page(heading("Deep"))
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app Ties
    caps   = []
    routes = {
        "/"         -> Home,
        "/a/*"      -> Deep,
        "/a/:x/:z"  -> Deeper,
        "/a/:x"     -> A,
        "/a/:y"     -> B,
        "/404"      -> NotFound
    }
    init   = []
`;
    // `/a/*` is declared first, but both parameter routes outrank it.
    const [one, two, three] = await textsAt(src, "/a/1", "/a/1/2", "/a/1/2/3");
    expect(one).toContain("A 1");
    expect(two).toContain("Deeper 2");
    expect(three).toContain("Deep");
  });

  it("ranks the children of a sub-routes parent the same way", async () => {
    const src = `
tile Tab      = page(heading("Tab " + route.params.get-or("tab", "?")))
tile NewItem  = page(heading("New item form"))
tile SHome    = page(heading("Settings home"))
tile Layout
    sub-routes = {
        "/s/:tab" -> Tab,
        "/s/new"  -> NewItem,
        "/s"      -> SHome
    }
    = page(heading("Settings"), route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app SubOrder
    caps   = []
    routes = {"/" -> Home, "/s/*" -> Layout, "/404" -> NotFound}
    init   = []
`;
    const [text] = await textsAt(src, "/s/new");
    expect(text).toContain("Settings");
    expect(text).toContain("New item form");
  });

  it("gives the path to a more specific sibling over a sub-routes parent", async () => {
    const src = `
tile Section  = page(heading("Section " + route.params.get-or("section", "?")))
tile Account  = page(heading("Account child"))
tile SHome    = page(heading("Settings home"))
tile Layout
    sub-routes = {"/settings/account" -> Account, "/settings" -> SHome}
    = page(heading("Settings layout"), route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app SiblingOwns
    caps   = []
    routes = {
        "/"                  -> Home,
        "/settings/*"        -> Layout,
        "/settings/:section" -> Section,
        "/404"               -> NotFound
    }
    init   = []
`;
    // `/settings/:section` outranks `/settings/*`, so the parent's child map never sees this path: the sibling renders, without the layout.
    const [text, deeper] = await textsAt(src, "/settings/account", "/settings/account/x");
    expect(text).toContain("Section account");
    expect(text).not.toContain("Settings layout");
    expect(text).not.toContain("Account child");
    // A deeper path only the wildcard takes still goes through the parent, which falls back to its default child.
    expect(deeper).toContain("Settings layout");
    expect(deeper).toContain("Settings home");
  });

  it("ranks the root path above a root wildcard", async () => {
    const src = `
tile Shell    = page(heading("Shell"))
tile Home     = page(heading("Home page"))
tile NotFound = page(heading("404"))
app RootShell
    caps   = []
    routes = {"/*" -> Shell, "/" -> Home, "/404" -> NotFound}
    init   = []
`;
    // `/*` matches `/` too; the pattern that ends where the path ends wins.
    const [root, other] = await textsAt(src, "/", "/anything");
    expect(root).toContain("Home page");
    expect(other).toContain("Shell");
  });

  it("serves the same route from renderToString as the client renders", async () => {
    const app = await loadSource(PARAM_FIRST, ["nav.push"]);
    const out = await renderToString(app, { route: "/todos/new", routing });
    expect(out.html).toContain("New todo form");
    expect(out.html).not.toContain("Detail");
    // The server binds the parameters too, not just the pattern.
    const param = await renderToString(app, { route: "/todos/42", routing });
    expect(param.html).toContain("Detail 42");
  });
});

describe("redirect order", () => {
  it("a redirect is ranked together with the routes that render", async () => {
    const src = `
tile NewTodo  = page(heading("New todo form"))
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app RedirectVsPage
    caps   = []
    routes = {
        "/"          -> Home,
        "/todos/*"   ->> "/",
        "/todos/new" -> NewTodo,
        "/404"       -> NotFound
    }
    init   = []
`;
    const [owned, moved] = await textsAt(src, "/todos/new", "/todos/42");
    // The static page outranks the wildcard redirect declared above it.
    expect(owned).toContain("New todo form");
    // Anything else under `/todos` is still redirected home.
    expect(moved).toContain("Home");
    expect(moved).not.toContain("New todo form");
  });

  it("ranks top-level redirects among themselves", async () => {
    const src = `
tile ByParam  = page(heading("landed by param"))
tile ByStar   = page(heading("landed by wildcard"))
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app RedirectOrder
    caps   = []
    routes = {
        "/"        -> Home,
        "/old/*"   ->> "/star",
        "/old/:id" ->> "/param",
        "/param"   -> ByParam,
        "/star"    -> ByStar,
        "/404"     -> NotFound
    }
    init   = []
`;
    const [byParam, byStar] = await textsAt(src, "/old/7", "/old/7/8");
    // `/old/*` is declared first, but `/old/:id` is the more specific redirect.
    expect(byParam).toContain("landed by param");
    // The wildcard still owns what the parameter cannot take.
    expect(byStar).toContain("landed by wildcard");
  });

  it("scans sub-route redirects only under the route that owns the path", async () => {
    const src = `
tile Detail   = page(heading("Detail " + route.params.get-or("id", "?")))
tile Fresh    = page(heading("the redirect target"))
tile SHome    = page(heading("Section home"))
tile Layout
    sub-routes = {
        "/x/legacy/*" ->> "/x-new",
        "/x"        -> SHome
    }
    = page(heading("Section"), route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app RedirectNarrowing
    caps   = []
    routes = {
        "/"      -> Home,
        "/x/:id" -> Detail,
        "/x/*"   -> Layout,
        "/x-new" -> Fresh,
        "/404"   -> NotFound
    }
    init   = []
`;
    // `/x/:id` outranks `/x/*`, so the parent's `/x/legacy/*` redirect, which matches this path too, never applies to it.
    const [owned, moved] = await textsAt(src, "/x/legacy", "/x/legacy/deep");
    expect(owned).toContain("Detail legacy");
    expect(owned).not.toContain("the redirect target");
    // The parent still owns — and still redirects — a path no other route takes.
    expect(moved).toContain("the redirect target");
  });

  it("ranks a child redirect together with the children that render", async () => {
    const src = `
tile Kept     = page(heading("Kept child"))
tile Moved    = page(heading("Moved page"))
tile SHome    = page(heading("Section home"))
tile Layout
    sub-routes = {
        "/s/old/*"    ->> "/moved",
        "/s/old/keep" -> Kept,
        "/s"          -> SHome
    }
    = page(heading("Section"), route-outlet())
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app ChildRedirectVsPage
    caps   = []
    routes = {"/" -> Home, "/s/*" -> Layout, "/moved" -> Moved, "/404" -> NotFound}
    init   = []
`;
    const [owned, moved] = await textsAt(src, "/s/old/keep", "/s/old/other");
    expect(owned).toContain("Kept child");
    expect(owned).not.toContain("Moved page");
    expect(moved).toContain("Moved page");
  });
});
