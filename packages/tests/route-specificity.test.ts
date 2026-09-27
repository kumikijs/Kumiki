// routing.md §3.1.2: routes are tried most specific first — segment by
// segment, static > parameter > wildcard — and definition order only breaks a
// tie. The corpus example (`153-route-specificity`) pins the top-level order
// through its scenario; this suite adds what one example cannot: the same app
// with its entries in the other order, the ranking inside a `sub-routes`
// parent, and the SSR pass, which resolves the route through the same helper.

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
tile Deep     = page(heading("Deep"))
tile Home     = page(heading("Home"))
tile NotFound = page(heading("404"))
app Ties
    caps   = []
    routes = {
        "/"         -> Home,
        "/a/*"      -> Deep,
        "/a/:x/:z"  -> B,
        "/a/:x"     -> A,
        "/a/:y"     -> B,
        "/404"      -> NotFound
    }
    init   = []
`;
    // `/a/*` is declared first, but both parameter routes outrank it.
    expect(await textAt(src, "/a/1")).toContain("A 1");
    expect(await textAt(src, "/a/1/2")).not.toContain("Deep");
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
    expect(await textAt(src, "/s/new")).toContain("New item form");
    expect(await textAt(src, "/s/billing")).toContain("Tab billing");
  });

  it("serves the same route from renderToString as the client renders", async () => {
    const app = await loadSource(PARAM_FIRST, ["nav.push"]);
    const out = await renderToString(app, { route: "/todos/new", routing });
    expect(out.html).toContain("New todo form");
    expect(out.html).not.toContain("Detail");
  });
});
