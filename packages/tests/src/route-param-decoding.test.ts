// The corpus example `205-path-param-stray-percent` follows a link and a scenario `navigate`;
// these are the other ways a path reaches the router.

import { type AppShape, mount, renderToString, routing } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { freshRoot, textAt, tick } from "./helpers/dom.ts";
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

async function mountInHistory(): Promise<HTMLElement> {
  const root = freshRoot();
  mounted.push({ root, dispose: mount(await freshApp(), root).dispose });
  return root;
}

const memoryTextAt = async (path: string): Promise<string> => textAt(await freshApp(), path);

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
    const text = await memoryTextAt(path);
    expect(text).toContain(heading);
    expect(text).toContain(`at ${path}`);
    expect(text).not.toContain("404");
  });

  it("renders its route when the app mounts at that URL", async () => {
    window.history.replaceState(null, "", "/items/100%");
    // The URL parser keeps the invalid escape, so the router is handed it raw.
    expect(window.location.pathname).toBe("/items/100%");
    const root = await mountInHistory();
    expect(root.textContent).toContain("Item [100%]");
    expect(root.textContent).toContain("at /items/100%");
  });

  it("renders its route when a navigate effect goes there", async () => {
    const root = await mountInHistory();
    const btn = root.querySelector("button");
    expect(btn?.textContent).toBe("go");
    btn?.click();
    await tick(0);
    expect(window.location.pathname).toBe("/items/100%");
    expect(root.textContent).toContain("Item [100%]");
  });

  it("renders its route when the user goes back to it", async () => {
    const root = await mountInHistory();
    expect(root.textContent).toContain("Home");
    window.history.pushState(null, "", "/items/50%off");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(root.textContent).toContain("Item [50%off]");
  });

  it("is matched by a redirect the same way", async () => {
    expect(await memoryTextAt("/old/100%")).toContain("About");
  });

  it("is matched by a sub-route the same way", async () => {
    const text = await memoryTextAt("/settings/100%");
    expect(text).toContain("Settings");
    expect(text).toContain("Tab [100%]");
  });

  it("renders its route on the server, as the client does", async () => {
    const out = await renderToString(await freshApp(), { route: "/items/100%", routing });
    const served = textOf(out.html);
    expect(served).toContain("Item [100%]");
    expect(served).toBe(await memoryTextAt("/items/100%"));
  });
});

describe("a parameter segment that is valid percent-encoding", () => {
  it.each([
    ["an escaped slash", "/items/a%2Fb", "Item [a/b]"],
    ["an escaped %", "/items/100%25", "Item [100%]"],
    ["a multi-byte escape", "/items/%E3%81%82", "Item [あ]"],
  ])("%s is decoded, and route.path keeps the escapes", async (_what, path, heading) => {
    const text = await memoryTextAt(path);
    expect(text).toContain(heading);
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
    expect(await memoryTextAt("/about")).toContain("About");
    expect(await memoryTextAt("/about%")).toContain("404 /about%");
    expect(await memoryTextAt("/%61bout")).toContain("404 /%61bout");
  });
});
