import { app, feature } from "@kumikijs/examples";
import { type AppShape, mount, renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const EXAMPLE = feature("154-ssr-redirect");

function textOf(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}

async function clientText(path: string, app?: AppShape): Promise<string> {
  app ??= await loadApp(EXAMPLE);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(app, root, { router: "memory", initialPath: path });
  const text = root.textContent ?? "";
  handle.dispose();
  root.remove();
  return text;
}

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
    expect(served).toBe(await clientText(from));
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

  it("resolves a literal redirect when no routing module is passed", async () => {
    const app = await loadApp(EXAMPLE);
    const out = await renderToString(app, { route: "/old" });
    expect(textOf(out.html)).toContain("Home");
    expect(out.snapshot.route).toBe("/");
  });

  it("resolves a literal redirect asked with a query when no routing module is passed", async () => {
    const app = await loadApp(EXAMPLE);
    const out = await renderToString(app, { route: "/old?ref=x" });
    expect(textOf(out.html)).toContain("Home");
    expect(out.snapshot.route).toBe("/");
  });
});

describe("renderToString reads the requested path as the client does", () => {
  it.each([["//foo"], ["/a/../b"]])("%s is matched as written", async (path) => {
    const app = await loadSource(`
tile Home     = page(heading("home"))
tile B        = page(heading("b"))
tile NotFound = page(heading("404"))
app R
    caps   = []
    routes = {"/" -> Home, "/b" -> B, "/404" -> NotFound}
    init   = []
`);
    const out = await renderToString(app, { route: path, routing });
    const served = textOf(out.html);
    expect(served).toBe(await clientText(path, app));
    expect(served).toBe("404");
  });
});
