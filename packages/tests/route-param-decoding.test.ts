// routing.md §3.1.1: a `:name` segment reaches `route.params` percent-decoded,
// and a segment that is not valid percent-encoding (a stray `%`, or escapes
// that do not spell UTF-8) matches the parameter as written. A URL is user
// input, so such a path renders its route; it never throws out of the router.
// The corpus example (`205-path-param-stray-percent`) follows a link and the
// scenario's `navigate` there. This suite covers the other ways a path reaches
// the router: the URL the app mounts at, a `navigate` effect, a popstate, a
// redirect lookup, a sub-route, and the server render.

import {
  type AppShape,
  type MountOptions,
  mount,
  renderToString,
  routing,
} from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SRC = `
reducer go on=ui.click(GoBtn) do= emit navigate({path: "/items/100%", params: {}})

tile GoBtn    = button(text="go")
tile Item     = page(heading("Item [" + route.params.get-or("id", "?") + "]"),
                     text("at " + route.path))
tile About    = page(heading("About"))
tile Tab      = page(heading("Tab [" + route.params.get-or("tab", "?") + "]"))
tile SHome    = page(heading("Settings home"))
tile Settings
    sub-routes = {"/settings/:tab" -> Tab, "/settings" -> SHome}
    = page(heading("Settings"), route-outlet())
tile Home     = page(heading("Home"), GoBtn)
tile NotFound = page(heading("404 " + route.path))

app Pct
    caps   = [nav.push]
    routes = {
        "/"           -> Home,
        "/about"      -> About,
        "/items/:id"  -> Item,
        "/old/:id"    ->> "/about",
        "/settings/*" -> Settings,
        "/404"        -> NotFound
    }
    init   = []
`;

const freshApp = (): Promise<AppShape> => loadSource(SRC, ["nav.push"]);

// Torn down after each test, a failed one included: a history-mode mount left
// behind keeps its popstate listener and would answer the next test's popstate.
const mounted: Array<{ root: HTMLElement; dispose: () => void }> = [];

/** Mount a fresh copy of the app; without `opts` it reads the real history. */
async function mountWith(opts?: MountOptions): Promise<HTMLElement> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mounted.push({ root, dispose: mount(await freshApp(), root, opts).dispose });
  return root;
}

/** What the app renders when it is mounted at `path` in a memory router. */
async function textAt(path: string): Promise<string> {
  const root = await mountWith({ router: "memory", initialPath: path });
  return root.textContent ?? "";
}

function textOf(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}

afterEach(() => {
  for (const m of mounted.splice(0)) {
    m.dispose();
    m.root.remove();
  }
  window.history.replaceState(null, "", "/");
});

describe("a parameter segment that is not valid percent-encoding", () => {
  it.each([
    ["a stray % at the end", "/items/100%", "Item [100%]"],
    ["a % not followed by two hex digits", "/items/50%off", "Item [50%off]"],
    ["escapes that do not spell UTF-8", "/items/%E3%81", "Item [%E3%81]"],
    ["a valid escape beside a stray %, none decoded", "/items/%41%", "Item [%41%]"],
  ])("%s matches the parameter as written", async (_what, path, heading) => {
    const text = await textAt(path);
    expect(text).toContain(heading);
    expect(text).toContain(`at ${path}`);
    expect(text).not.toContain("404");
  });

  it("renders its route when the app mounts at that URL", async () => {
    window.history.replaceState(null, "", "/items/100%");
    // The URL parser keeps the invalid escape, so the router is handed it raw.
    expect(window.location.pathname).toBe("/items/100%");
    const root = await mountWith();
    expect(root.textContent).toContain("Item [100%]");
    expect(root.textContent).toContain("at /items/100%");
  });

  it("renders its route when a navigate effect goes there", async () => {
    const root = await mountWith();
    const btn = root.querySelector("button");
    expect(btn?.textContent).toBe("go");
    btn?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(window.location.pathname).toBe("/items/100%");
    expect(root.textContent).toContain("Item [100%]");
  });

  it("renders its route when the user goes back to it", async () => {
    const root = await mountWith();
    expect(root.textContent).toContain("Home");
    window.history.pushState(null, "", "/items/50%off");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(root.textContent).toContain("Item [50%off]");
  });

  it("is matched by a redirect the same way", async () => {
    expect(await textAt("/old/100%")).toContain("About");
  });

  it("is matched by a sub-route the same way", async () => {
    const text = await textAt("/settings/100%");
    expect(text).toContain("Settings");
    expect(text).toContain("Tab [100%]");
  });

  it("renders its route on the server, as the client does", async () => {
    const out = await renderToString(await freshApp(), { route: "/items/100%", routing });
    const served = textOf(out.html);
    expect(served).toContain("Item [100%]");
    expect(served).toBe(await textAt("/items/100%"));
  });
});

describe("a parameter segment that is valid percent-encoding", () => {
  it.each([
    ["an escaped slash", "/items/a%2Fb", "Item [a/b]"],
    ["an escaped %", "/items/100%25", "Item [100%]"],
    ["a multi-byte escape", "/items/%E3%81%82", "Item [あ]"],
  ])("%s is decoded", async (_what, path, heading) => {
    const text = await textAt(path);
    expect(text).toContain(heading);
    // `route.path` stays the path as the URL holds it.
    expect(text).toContain(`at ${path}`);
  });
});

describe("the rest of the URL around a parameter", () => {
  it("reads a stray % in the query and the hash as written", async () => {
    const app = await freshApp();
    const route = routing.parseLocation(app.routes, {
      pathname: "/items/1",
      search: "?q=100%",
      hash: "#50%",
    });
    expect(route.params).toEqual({ id: "1" });
    expect(route.query).toEqual({ q: "100%" });
    expect(route.hash).toEqual({ _tag: "Some", _0: "50%" });
  });

  it("does not decode a static segment, so an escaped one is no match", async () => {
    expect(await textAt("/about")).toContain("About");
    expect(await textAt("/about%")).toContain("404 /about%");
    expect(await textAt("/%61bout")).toContain("404 /%61bout");
  });
});
