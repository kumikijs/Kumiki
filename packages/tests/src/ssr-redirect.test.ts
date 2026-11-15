import { app, feature } from "@kumikijs/examples";
import { renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { textAt, textOf } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("154-ssr-redirect");

describe("renderToString resolves static redirects", () => {
  it.each([
    ["a top-level redirect", "/old", "/", "Home"],
    ["a top-level redirect asked with a query and a hash", "/old?ref=x#top", "/", "Home"],
    [
      "a redirect inside a sub-routes map",
      "/settings/legacy",
      "/settings/billing",
      "Billing settings",
    ],
    [
      "a sub-routes redirect asked with a query",
      "/settings/legacy?tab=2",
      "/settings/billing",
      "Billing settings",
    ],
  ])("%s serves its target, as mount renders it", async (_what, from, to, heading) => {
    const app = await loadApp(EXAMPLE);
    const out = await renderToString(app, { route: from, routing });
    const served = textOf(out.html);
    expect(served).toContain(heading);
    expect(served).toBe(textAt(app, from));
    expect(out.snapshot.route).toBe(to);
    expect(out.bootstrapEpisode.trigger.target).toBe(to);
  });

  it("serves the blog app's home page, which redirects to the post list", async () => {
    const blog = app("03-blog");
    const out = await renderToString(await loadApp(blog), { route: "/", routing });
    expect(out.snapshot.route).toBe("/posts");
    expect(textOf(out.html)).not.toContain("Page not found");
  });

  it("names the target as the route the tiles read while rendering", async () => {
    const app = await loadSource(`
tile Home     = page(heading("at " + route.path))
tile NotFound = page(heading("404"))
app R
    caps   = []
    routes = {"/old" ->> "/", "/" -> Home, "/404" -> NotFound}
    init   = []
`);
    const out = await renderToString(app, { route: "/old", routing });
    expect(textOf(out.html)).toBe("at /");
  });

  it.each([
    ["/old"],
    ["/old?ref=x"],
  ])("resolves a literal redirect asked as %s when no routing module is passed", async (route) => {
    const out = await renderToString(await loadApp(EXAMPLE), { route });
    expect(textOf(out.html)).toContain("Home");
    expect(out.snapshot.route).toBe("/");
  });

  it.each([
    ["/旧", "home", "/"],
    ["/%E6%97%A7", "home", "/"],
    ["/ja/概要", "ja", "/ja/%E6%A6%82%E8%A6%81"],
    ["/ja/%E6%A6%82%E8%A6%81", "ja", "/ja/%E6%A6%82%E8%A6%81"],
  ])("serves a non-ASCII pattern asked as %s when no routing module is passed", async (route, heading, served) => {
    const app = await loadSource(`
tile Home     = page(heading("home"))
tile Ja       = page(heading("ja"))
tile NotFound = page(heading("404"))
app R
    caps   = []
    routes = {"/旧" ->> "/", "/" -> Home, "/ja/概要" -> Ja, "/404" -> NotFound}
    init   = []
`);
    const out = await renderToString(app, { route });
    expect(textOf(out.html)).toBe(heading);
    expect(out.snapshot.route).toBe(served);
  });
});

describe("renderToString reads the requested path as the client does", () => {
  it.each([
    ["//foo", "404 //foo"],
    ["/a/../b", "b at /b"],
    ["/ja/概要", "ja at /ja/%E6%A6%82%E8%A6%81"],
    ["/ja/%E6%A6%82%E8%A6%81", "ja at /ja/%E6%A6%82%E8%A6%81"],
    ["/docs/old", "docs at /docs/moved"],
  ])("%s lands where a browser's location does", async (path, served) => {
    const app = await loadSource(`
tile Home     = page(heading("home"))
tile B        = page(heading("b at " + route.path))
tile Ja       = page(heading("ja at " + route.path))
tile Docs     = page(heading("docs at " + route.path))
tile NotFound = page(heading("404 " + route.path))
app R
    caps   = []
    routes = {
        "/"           -> Home,
        "/b"          -> B,
        "/ja/概要"    -> Ja,
        "/docs/old"   ->> "moved",
        "/docs/:page" -> Docs,
        "/404"        -> NotFound
    }
    init   = []
`);
    const out = await renderToString(app, { route: path, routing });
    expect(textOf(out.html)).toBe(served);
    expect(textAt(app, path)).toBe(served);
  });
});
