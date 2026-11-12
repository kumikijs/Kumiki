import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { textAt } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

/** A parent `Layout` whose one sub-route is `child`, beside the entries in `routes`. */
const program = (child: string, routes: string) => `
tile Child    = page(heading("child page"))
tile Other    = page(heading("other page"))
tile Home     = page(heading("home page"))
tile NotFound = page(heading("404"))
tile Layout sub-routes = {${child} -> Child} = page(heading("layout"), route-outlet())
app A
    caps   = []
    routes = {"/" -> Home, ${routes}, "/404" -> NotFound}
    init   = []
`;

const SECTION = `"/settings/*" -> Layout, "/settings/:section" -> Other`;

// Each row lists paths the child matches: where check warns, the router renders it at none of them;
// where check is silent, at every one.
describe("W0218 agrees with the router on which sub-routes it never reaches", () => {
  it.each<[string, string, string, string[]]>([
    ["a parameter sibling", `"/settings/account"`, SECTION, ["/settings/account"]],
    [
      "a static sibling at the same path",
      `"/settings/account"`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
      ["/settings/account"],
    ],
    [
      "a wildcard sibling more specific than a root parent",
      `"/settings/account"`,
      `"/*" -> Layout, "/settings/*" -> Other`,
      ["/settings/account"],
    ],
    ["a parameter sibling, over a parameter child", `"/settings/:tab"`, SECTION, ["/settings/a"]],
    [
      "a redirect sibling",
      `"/settings/account"`,
      `"/settings/*" -> Layout, "/settings/:section" ->> "/"`,
      ["/settings/account"],
    ],
    [
      "a sibling that ties with the parent and is declared first",
      `"/x/y"`,
      `"/:a/*" -> Other, "/:b/*" -> Layout`,
      ["/x/y"],
    ],
  ])("warns, and never renders the child, under %s", async (_, child, routes, paths) => {
    const src = program(child, routes);
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual(["W0218"]);
    const app = await loadSource(src);
    for (const path of paths) expect(textAt(app, path), path).not.toContain("child page");
  });

  it.each<[string, string, string, string[]]>([
    [
      "a wildcard child the sibling takes only part of",
      `"/settings/*"`,
      SECTION,
      ["/settings", "/settings/a/b"],
    ],
    [
      "a parameter child a static sibling takes one path of",
      `"/settings/:tab"`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
      ["/settings/billing"],
    ],
    [
      "a child whose covering sibling ranks after the parent",
      `"/settings"`,
      `"/settings/*" -> Layout, "/:lang" -> Other`,
      ["/settings"],
    ],
    [
      "a child whose sibling ties with the parent and is declared after it",
      `"/x/y"`,
      `"/:b/*" -> Layout, "/:a/*" -> Other`,
      ["/x/y"],
    ],
  ])("stays silent, and renders the child, for %s", async (_, child, routes, paths) => {
    const src = program(child, routes);
    expect(check(parse(lex(src)))).toEqual([]);
    const app = await loadSource(src);
    for (const path of paths) expect(textAt(app, path), path).toContain("child page");
  });
});
