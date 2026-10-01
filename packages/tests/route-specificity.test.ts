// routing.md §3.1.2: routes are tried most specific first — segment by
// segment, static > parameter > wildcard — and definition order only breaks a
// tie. The corpus example (`153-route-specificity`) pins the top-level order
// through its scenario; this suite adds what one example cannot: the same app
// with its entries in the other order, the ranking inside a `sub-routes`
// parent, redirects ranked together with the routes that render, and the SSR
// pass, which resolves the route through the same helper when it is handed
// `routing`.

import { mount, renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
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

async function textAt(src: string, path: string): Promise<string> {
  const app = await loadSource(src, ["nav.push"]);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(app, root, { router: "memory", initialPath: path });
  const text = root.textContent ?? "";
  handle.dispose();
  root.remove();
  return text;
}

describe("route match order", () => {
  it("a static segment outranks a parameter, whichever is declared first", async () => {
    for (const src of [PARAM_FIRST, STATIC_FIRST]) {
      expect(await textAt(src, "/todos/new")).toContain("New todo form");
      expect(await textAt(src, "/todos/42")).toContain("Detail 42");
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
    expect(await textAt(src, "/a/1")).toContain("A 1");
    expect(await textAt(src, "/a/1/2")).toContain("Deeper 2");
    expect(await textAt(src, "/a/1/2/3")).toContain("Deep");
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
    const text = await textAt(src, "/s/new");
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
    // `/settings/:section` outranks `/settings/*`, so the parent's child map
    // never sees this path: the sibling renders, without the layout.
    const text = await textAt(src, "/settings/account");
    expect(text).toContain("Section account");
    expect(text).not.toContain("Settings layout");
    expect(text).not.toContain("Account child");
    // A deeper path only the wildcard takes still goes through the parent,
    // which falls back to its default child (§3.6.3).
    const deeper = await textAt(src, "/settings/account/x");
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
    expect(await textAt(src, "/")).toContain("Home page");
    expect(await textAt(src, "/anything")).toContain("Shell");
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
    // The static page outranks the wildcard redirect declared above it.
    const owned = await textAt(src, "/todos/new");
    expect(owned).toContain("New todo form");
    // Anything else under `/todos` is still redirected home.
    const moved = await textAt(src, "/todos/42");
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
    // `/old/*` is declared first, but `/old/:id` is the more specific redirect.
    expect(await textAt(src, "/old/7")).toContain("landed by param");
    // The wildcard still owns what the parameter cannot take.
    expect(await textAt(src, "/old/7/8")).toContain("landed by wildcard");
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
    // `/x/:id` outranks `/x/*`, so the parent's `/x/legacy/*` redirect, which
    // matches this path too, never applies to it.
    const owned = await textAt(src, "/x/legacy");
    expect(owned).toContain("Detail legacy");
    expect(owned).not.toContain("the redirect target");
    // The parent still owns — and still redirects — a path no other route takes.
    const moved = await textAt(src, "/x/legacy/deep");
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
    const owned = await textAt(src, "/s/old/keep");
    expect(owned).toContain("Kept child");
    expect(owned).not.toContain("Moved page");
    expect(await textAt(src, "/s/old/other")).toContain("Moved page");
  });
});
