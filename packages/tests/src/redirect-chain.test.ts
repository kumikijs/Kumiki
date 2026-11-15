import { renderToString, routing, runScenario, type StepResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const SRC = `
reducer back on=ui.click(BackBtn) do= emit navigate-back()
tile BackBtn  = button(text="Back", onClick=back)
tile Where    = column(
                  text("[at " + route.path + "]"),
                  text("[id " + route.params.get-or("id", "-") + "]"),
                  text("[ref " + route.query.get-or("ref", "-") + "]"),
                  text("[hash " + route.hash.get-or("-") + "]"),
                  BackBtn)
tile Home     = page(heading("Home page"), Where)
tile Item     = page(heading("Item page"), Where)
tile Help     = page(heading("Help page"), Where)
tile Profile  = page(heading("Profile page"), Where)
tile AHome    = page(heading("Account home"), Where)
tile NotFound = page(heading("Not found"), Where)
tile Account
    sub-routes = {
        "/account/u/:id"      ->> "/account/people/:id",
        "/account/people/:id" ->> "/account/users/:id",
        "/account/users/:id"  -> Profile,
        "/account/old"        ->> "/v1",
        "/account"            -> AHome
    }
    = page(route-outlet())
app Redirects
    caps   = [nav.push, nav.back]
    routes = {
        "/v1"        ->> "/v2",
        "/v2"        ->> "/",
        "/old/:id"   ->> "/items/:id",
        "/acct/:id"  ->> "/account/u/:id",
        "/docs/*"    ->> "/help/*",
        "/gone/*"    ->> "/",
        "/p/:id"     ->> "/q/:id",
        "/q/:id"     ->> "/p/:id",
        "/g/*"       ->> "/g/x/*",
        "/rel/old"   ->> "moved",
        "/rel/moved" ->> "/v1",
        "/top"       ->> "/p/1",
        "/flat/*"    ->> "/*",
        "/qs/a"      ->> "/qs/b?ref=x",
        "/qs/b"      ->> "/",
        "/keep/a"    ->> "/keep/b",
        "/keep/b"    ->> "/items/9?ref=k#top",
        "/old2/:id"  ->> "/items/:id?ref=x",
        "/pq/:id"    ->> "/qp/:id?ref=x",
        "/qp/:id"    ->> "/pq/:id",
        "/"          -> Home,
        "/items/:id" -> Item,
        "/help/*"    -> Help,
        "/account/*" -> Account,
        "/404"       -> NotFound
    }
    init   = []
`;

/** `/404` as a target beside a `/*` redirect that would match that path too. */
const GONE = `
tile Home     = page(heading("Home page"), text("[at " + route.path + "]"))
tile NotFound = page(heading("Not found"), text("[at " + route.path + "]"))
app Gone
    caps   = [nav.push]
    routes = {
        "/gone" ->> "/404",
        "/*"    ->> "/",
        "/"     -> Home,
        "/404"  -> NotFound
    }
    init   = []
`;

type Step = { navigate: string } | { clickText: string };

/** Asserts nothing about errors, so a case that expects a reported loop can read it. */
async function walkIn(src: string, initialPath: string, steps: Step[]): Promise<StepResult[]> {
  const app = await loadSource(src, ["nav.push", "nav.back"]);
  const scripted = steps.length > 0 ? steps.map((s) => ({ do: s })) : [{}];
  const report = await withRoot((root) =>
    runScenario(app, root, { steps: scripted }, { router: "memory", initialPath }),
  );
  return report.steps;
}

const walk = (initialPath: string, ...steps: Step[]): Promise<StepResult[]> =>
  walkIn(SRC, initialPath, steps);

/** The page text after the last step, failing on any action that could not run or error reported. */
async function landed(initialPath: string, ...steps: Step[]): Promise<string> {
  const results = await walk(initialPath, ...steps);
  for (const r of results) {
    expect(r.actionError, r.label ?? r.action).toBeUndefined();
    expect(r.errors, r.label ?? r.action).toEqual([]);
  }
  return results.at(-1)?.domText ?? "";
}

const nav = (navigate: string): Step => ({ navigate });
const BACK: Step = { clickText: "Back" };

describe("a redirect whose target is redirected in turn", () => {
  it("follows the chain to the page, and puts that path in the URL", async () => {
    const text = await landed("/", nav("/v1"));
    expect(text).toContain("Home page");
    expect(text).toContain("[at /]");
  });

  it("follows it on the path the app mounts at", async () => {
    expect(await landed("/v1")).toContain("[at /]");
  });

  it("leaves one history entry, holding where the chain landed", async () => {
    const [redirected, back, ...more] = await walk("/items/7", nav("/v1"), BACK);
    expect(more).toEqual([]);
    expect(redirected?.errors).toEqual([]);
    expect(redirected?.domText).toContain("[at /]");
    expect(back?.errors).toEqual([]);
    expect(back?.domText).toContain("Item page");
    expect(back?.domText).toContain("[at /items/7]");
  });

  it("follows a chain of exactly 20 redirects to its page", async () => {
    const hops = Array.from({ length: 20 }, (_, i) => `"/r${i}" ->> "/r${i + 1}"`);
    const src = `tile Page = page(heading("[at " + route.path + "]"))
app Twenty
    caps   = [nav.push]
    routes = {${hops.join(", ")}, "/r20" -> Page, "/404" -> Page}
    init   = []`;
    const results = await walkIn(src, "/r0", []);
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(results.at(-1)?.domText).toContain("[at /r20]");
  });

  it.each([
    ["/gone", "Not found", "[at /404]"],
    ["/elsewhere", "Home page", "[at /]"],
  ])("ends at the path /404 beside a catch-all redirect: %s shows %s", async (from, page, at) => {
    const results = await walkIn(GONE, "/", [nav(from)]);
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(results.at(-1)?.domText).toContain(page);
    expect(results.at(-1)?.domText).toContain(at);
  });
});

describe("a redirect target names what its source binds", () => {
  it("substitutes a parameter", async () => {
    const text = await landed("/", nav("/old/42"));
    expect(text).toContain("Item page");
    expect(text).toContain("[at /items/42]");
    expect(text).toContain("[id 42]");
  });

  it("substitutes it on the path the app mounts at", async () => {
    expect(await landed("/old/42")).toContain("[at /items/42]");
  });

  it("carries the segment as the URL has it, and the target decodes it once", async () => {
    const text = await landed("/", nav("/old/a%20b"));
    expect(text).toContain("[at /items/a%20b]");
    expect(text).toContain("[id a b]");
  });

  it("puts a wildcard source's rest where the target writes *", async () => {
    expect(await landed("/", nav("/docs/a/b"))).toContain("[at /help/a/b]");
    expect(await landed("/", nav("/docs"))).toContain("[at /help]");
  });

  it("drops the rest when the target writes no *", async () => {
    expect(await landed("/", nav("/gone/a/b"))).toContain("[at /]");
  });
});

describe("a target that is not a path", () => {
  it("resolves against the path it redirects from, and is redirected in turn from there", async () => {
    expect(await landed("/", nav("/rel/old"))).toContain("[at /]");
    expect(await landed("/rel/old")).toContain("[at /]");
  });
});

describe("redirects in a sub-routes map", () => {
  it("follow a chain and substitute a parameter", async () => {
    const text = await landed("/", nav("/account/u/5"));
    expect(text).toContain("Profile page");
    expect(text).toContain("[at /account/users/5]");
    expect(text).toContain("[id 5]");
  });

  it("continue from a top-level redirect into a child one", async () => {
    expect(await landed("/", nav("/acct/5"))).toContain("[at /account/users/5]");
  });

  it("continue from a child redirect into the app's routes", async () => {
    expect(await landed("/", nav("/account/old"))).toContain("[at /]");
  });

  it("apply on the path the app mounts at", async () => {
    expect(await landed("/account/u/5")).toContain("[at /account/users/5]");
  });
});

describe("a redirect loop check cannot see", () => {
  it.each([
    ["on the path the app mounts at", "/p/1", [], "/p/1 ->> /q/1 ->> /p/1"],
    ["on a navigation", "/", [nav("/p/1")], "/p/1 ->> /q/1 ->> /p/1"],
    [
      "when the chain enters the loop after its start",
      "/",
      [nav("/top")],
      "/top ->> /p/1 ->> /q/1 ->> /p/1",
    ],
    ["when a target carries a query", "/", [nav("/pq/1")], "/pq/1 ->> /qp/1?ref=x ->> /pq/1"],
  ])("is stopped and reported when a path comes back, %s, and no redirect applies", async (_how, initialPath, steps, loop) => {
    const results = await walkIn(SRC, initialPath, steps);
    expect(results.flatMap((r) => r.errors)).toEqual([
      `[kumiki] redirect loop: ${loop} — stopped, no redirect applied`,
    ]);
    const text = results.at(-1)?.domText;
    expect(text).toContain("Not found");
    expect(text).toContain(`[at ${loop.split(" ")[0]}]`);
  });

  it("is stopped at the 21st redirect when no path comes back", async () => {
    const results = await walk("/g/1");
    const paths = Array.from({ length: 22 }, (_, k) => `/g/${"x/".repeat(k)}1`);
    expect(results.flatMap((r) => r.errors)).toEqual([
      `[kumiki] more than 20 redirects: ${paths.join(" ->> ")} — stopped, no redirect applied`,
    ]);
    expect(results.at(-1)?.domText).toContain("[at /g/1]");
  });
});

describe("what a redirect leaves of the requested URL", () => {
  it.each([
    "/v2?ref=x#top",
    "/v1?ref=x#top",
  ])("replaces the query and the hash along with the path: %s", async (from) => {
    const text = await landed("/", nav(from));
    expect(text).toContain("[at /]");
    expect(text).toContain("[ref -]");
    expect(text).toContain("[hash -]");
  });
});

describe("a query or a hash written in a target", () => {
  it("is left out of the path the next step looks up", async () => {
    const text = await landed("/", nav("/qs/a"));
    expect(text).toContain("Home page");
    expect(text).toContain("[at /]");
    expect(text).toContain("[ref -]");
  });

  it("is kept where the chain lands", async () => {
    const text = await landed("/", nav("/keep/a"));
    expect(text).toContain("[at /items/9]");
    expect(text).toContain("[ref k]");
    expect(text).toContain("[hash top]");
  });

  it("follows the parameter put into the path before it", async () => {
    const text = await landed("/", nav("/old2/5"));
    expect(text).toContain("[at /items/5]");
    expect(text).toContain("[id 5]");
    expect(text).toContain("[ref x]");
  });
});

describe("renderToString serves where a chain lands", () => {
  it.each([
    ["/v1", "/", "[at /]"],
    ["/old/42", "/items/42", "[id 42]"],
    ["/account/u/5", "/account/users/5", "[at /account/users/5]"],
    ["/rel/old", "/", "[at /]"],
    ["/flat", "/", "[at /]"],
    ["/keep/a", "/items/9?ref=k#top", "[ref k]"],
  ])("%s is served %s", async (from, to, shown) => {
    const app = await loadSource(SRC, ["nav.push", "nav.back"]);
    const out = await renderToString(app, { route: from, routing });
    expect(out.snapshot.route).toBe(to);
    expect(out.html).toContain(shown);
  });

  it("serves the /404 tile where a chain reaches the path /404", async () => {
    const app = await loadSource(GONE, ["nav.push"]);
    const out = await renderToString(app, { route: "/gone", routing });
    expect(out.snapshot.route).toBe("/404");
    expect(out.html).toContain("Not found");
  });

  it.each([
    "/v1",
    "/rel/old",
  ])("follows a chain of literal redirects from %s without a routing module", async (from) => {
    const app = await loadSource(SRC, ["nav.push", "nav.back"]);
    const out = await renderToString(app, { route: from });
    expect(out.snapshot.route).toBe("/");
    expect(out.html).toContain("Home page");
  });
});
