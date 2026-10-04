// routing.md §3.10: a `->>` redirect does what a `navigate-replace` to its
// target would, so a target that is itself redirected is redirected again, and
// a target names what its source binds. The corpus example
// (`208-redirect-chain-params`) pins the main shapes through its scenario; this
// suite adds the mount path, the percent-encoded parameter, the wildcard rest,
// the loops check cannot see, history after a chain, and the server.
//
// Every page shows where it landed — `[at <path>]`, `[id <param>]`,
// `[ref <query>]`, `[hash <hash>]` — so a step asserts the URL the runtime
// settled on, not only which tile rendered.

import { renderToString, routing, runScenario, type StepResult } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
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
        "/"          -> Home,
        "/items/:id" -> Item,
        "/help/*"    -> Help,
        "/account/*" -> Account,
        "/404"       -> NotFound
    }
    init   = []
`;

type Step = { navigate: string } | { clickText: string };

/**
 * Mount `src` at `initialPath` on the memory router, take `steps`, and return
 * every step's result. With no steps, one step that does nothing reads the
 * mounted page. What the mount itself reported comes first, as a step of its
 * own, only when it reported something. Nothing is asserted about errors here,
 * so a case that expects a reported loop can read it.
 */
async function walkIn(src: string, initialPath: string, steps: Step[]): Promise<StepResult[]> {
  const app = await loadSource(src, ["nav.push", "nav.back"]);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const scripted = steps.length > 0 ? steps.map((s) => ({ do: s })) : [{}];
  const report = await runScenario(
    app,
    root,
    { steps: scripted },
    { router: "memory", initialPath },
  );
  root.remove();
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
    // Back from `/` returns to the page before the redirect. Had the chain
    // pushed, or left `/v1` / `/v2` behind, Back would land on one of them and
    // be redirected straight back to `/`.
    const [redirected, back, ...more] = await walk("/items/7", nav("/v1"), BACK);
    expect(more).toEqual([]);
    expect(redirected?.errors).toEqual([]);
    expect(redirected?.domText).toContain("[at /]");
    expect(back?.errors).toEqual([]);
    expect(back?.domText).toContain("Item page");
    expect(back?.domText).toContain("[at /items/7]");
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
    // `/docs/*` matches `/docs` itself, with nothing for the rest.
    expect(await landed("/", nav("/docs"))).toContain("[at /help]");
  });

  it("drops the rest when the target writes no *", async () => {
    expect(await landed("/", nav("/gone/a/b"))).toContain("[at /]");
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
  // `/p/:id` and `/q/:id` send each other back and forth; `/g/*` sends every
  // path to a longer one it owns too. Neither is a static cycle, so check lets
  // both through (E0010 covers static paths) and the runtime stops them.
  it("is stopped and reported when a path comes back, and no redirect applies", async () => {
    // Once as the path the app mounts at, once navigated to.
    for (const results of [await walk("/p/1"), await walk("/", nav("/p/1"))]) {
      expect(results.flatMap((r) => r.errors)).toEqual([
        "[kumiki] redirect loop: /p/1 ->> /q/1 ->> /p/1 — stopped, no redirect applied",
      ]);
      const text = results.at(-1)?.domText;
      expect(text).toContain("Not found");
      expect(text).toContain("[at /p/1]");
    }
  });

  it("is stopped at the 21st redirect when no path comes back", async () => {
    const results = await walk("/g/1");
    // `/g/1`, then one path per redirect: the 20 a chain may take, and the
    // 21st it is refused.
    const paths = Array.from({ length: 22 }, (_, k) => `/g/${"x/".repeat(k)}1`);
    expect(results.flatMap((r) => r.errors)).toEqual([
      `[kumiki] more than 20 redirects: ${paths.join(" ->> ")} — stopped, no redirect applied`,
    ]);
    expect(results.at(-1)?.domText).toContain("[at /g/1]");
  });

  it("is followed to its page when it takes exactly 20 redirects", async () => {
    // The limit is on the redirects a chain takes, not on the paths it names.
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
});

describe("what a redirect leaves of the requested URL", () => {
  it("replaces the query and the hash along with the path", async () => {
    // A navigate-replace to the target names no query or hash, so none
    // survives — through one redirect or a chain.
    for (const from of ["/v2?ref=x#top", "/v1?ref=x#top"]) {
      const text = await landed("/", nav(from));
      expect(text).toContain("[at /]");
      expect(text).toContain("[ref -]");
      expect(text).toContain("[hash -]");
    }
  });
});

describe("renderToString serves where a chain lands", () => {
  it.each([
    ["/v1", "/", "[at /]"],
    ["/old/42", "/items/42", "[id 42]"],
    ["/account/u/5", "/account/users/5", "[at /account/users/5]"],
  ])("%s is served %s", async (from, to, shown) => {
    const app = await loadSource(SRC, ["nav.push", "nav.back"]);
    const out = await renderToString(app, { route: from, routing });
    expect(out.snapshot.route).toBe(to);
    expect(out.html).toContain(shown);
  });

  it("follows a chain of literal redirects without a routing module", async () => {
    const app = await loadSource(SRC, ["nav.push", "nav.back"]);
    const out = await renderToString(app, { route: "/v1" });
    expect(out.snapshot.route).toBe("/");
    expect(out.html).toContain("Home page");
  });
});
