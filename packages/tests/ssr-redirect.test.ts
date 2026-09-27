// routing.md §3.10 / runtime.md §10.6.1: a `->>` redirect is resolved before the
// route is rendered, on the server as on the client. The corpus example
// (`154-ssr-redirect`) pins the client through its scenario; a scenario never
// runs `renderToString`, so this suite renders each redirected URL on both paths
// and compares what they drew.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, "..", "examples", "features", "154-ssr-redirect.kumiki");

function textOf(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}

async function clientText(path: string): Promise<string> {
  const app = await loadApp(EXAMPLE);
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
    [
      "a redirect inside a sub-routes map",
      "/settings/legacy",
      "/settings/billing",
      "Billing settings",
    ],
  ])("%s serves its target, as mount renders it", async (_what, from, to, heading) => {
    const app = await loadApp(EXAMPLE);
    const out = await renderToString(app, { route: from, routing });
    const served = textOf(out.html);
    expect(served).toContain(heading);
    expect(served).toBe(await clientText(from));
    // The snapshot names the route the server drew, so hydration does not
    // start from one it did not.
    expect(out.snapshot.route).toBe(to);
  });

  it("serves the blog app's home page, which redirects to the post list", async () => {
    const blog = join(here, "..", "examples", "apps", "03-blog", "app.kumiki");
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
});
