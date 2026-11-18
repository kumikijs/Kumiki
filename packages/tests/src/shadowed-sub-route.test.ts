import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { textAt } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { logAfter, navigateTo } from "./helpers/scenario.ts";

/** A parent `Layout` whose sub-routes are `children`, beside the entries in `routes`. */
const program = (children: string, routes: string) => `
tile Child    = page(heading("child page"))
tile Other    = page(heading("other page"))
tile Home     = page(heading("home page"))
tile NotFound = page(heading("404"))
tile Layout sub-routes = {${children}} = page(heading("layout"), route-outlet())
app A
    caps   = []
    routes = {"/" -> Home, ${routes}, "/404" -> NotFound}
    init   = []
`;

const SECTION = `"/settings/*" -> Layout, "/settings/:section" -> Other`;

// Each row lists paths the child can render at, through its own key or as its parent's default
// child: where check warns, the router renders the page the row names at each of them and the child
// at none; where check is silent, the child at every one.
describe("W0218 agrees with the router on which sub-routes it never reaches", () => {
  it.each<[string, string, string, string[], string]>([
    [
      "a parameter sibling",
      `"/settings/account" -> Child`,
      SECTION,
      ["/settings/account"],
      "other page",
    ],
    [
      "a static sibling at the same path",
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
      ["/settings/account"],
      "other page",
    ],
    [
      "a wildcard sibling more specific than a root parent",
      `"/settings/account" -> Child`,
      `"/*" -> Layout, "/settings/*" -> Other`,
      ["/settings/account"],
      "other page",
    ],
    [
      "a parameter sibling, over a parameter child",
      `"/settings/:tab" -> Child`,
      SECTION,
      ["/settings/a"],
      "other page",
    ],
    [
      "a redirect sibling",
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/settings/:section" ->> "/"`,
      ["/settings/account"],
      "home page",
    ],
    [
      "a sibling that ties with the parent and is declared first",
      `"/x/y" -> Child`,
      `"/:a/*" -> Other, "/:b/*" -> Layout`,
      ["/x/y"],
      "other page",
    ],
    [
      "a parameter sibling, over a redirect child",
      `"/settings/old" ->> "/"`,
      SECTION,
      ["/settings/old"],
      "other page",
    ],
    [
      "a sibling that takes every path of a default child's parent",
      `"/:b" -> Child`,
      `"/:a/*" -> Other, "/:b/*" -> Layout`,
      ["/x", "/x/y"],
      "other page",
    ],
    [
      "a static sibling, over a redirect at the parent's bare path, which is no default child",
      `"/settings" ->> "/"`,
      `"/settings" -> Other, "/settings/*" -> Layout`,
      ["/settings"],
      "other page",
    ],
  ])("warns, and renders another page in place of the child, under %s", async (_, children, routes, paths, shown) => {
    const src = program(children, routes);
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual(["W0218"]);
    const app = await loadSource(src);
    for (const path of paths) {
      const text = textAt(app, path);
      expect(text, path).toContain(shown);
      expect(text, path).not.toContain("child page");
    }
  });

  it.each<[string, string, string, string[]]>([
    [
      "a wildcard child the sibling takes only part of",
      `"/settings/*" -> Child`,
      SECTION,
      ["/settings", "/settings/a/b"],
    ],
    [
      "a parameter child a static sibling takes one path of",
      `"/settings/:tab" -> Child`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
      ["/settings/billing"],
    ],
    [
      "a child whose covering sibling ranks after the parent",
      `"/settings" -> Child`,
      `"/settings/*" -> Layout, "/:lang" -> Other`,
      ["/settings"],
    ],
    [
      "a child whose sibling ties with the parent and is declared after it",
      `"/x/y" -> Child`,
      `"/:b/*" -> Layout, "/:a/*" -> Other`,
      ["/x/y"],
    ],
    [
      "a default child at the root, beside a top-level route at its own path",
      `"/about" -> Other, "/" -> Child`,
      `"/*" -> Layout`,
      ["/nowhere", "/a/b"],
    ],
    [
      "a default child beside a static sibling at its own path",
      `"/settings" -> Child`,
      `"/settings" -> Other, "/settings/*" -> Layout`,
      ["/settings/foo", "/settings/a/b"],
    ],
    [
      "a default child beside a parameter sibling that matches every path the key does",
      `"/:x" -> Child`,
      `"/:y" -> Other, "/:x/*" -> Layout`,
      ["/foo/bar"],
    ],
  ])("stays silent, and renders the child, for %s", async (_, children, routes, paths) => {
    const src = program(children, routes);
    expect(check(parse(lex(src)))).toEqual([]);
    const app = await loadSource(src);
    for (const path of paths) expect(textAt(app, path), path).toContain("child page");
  });

  it("runs a default child's route events at its parent's other paths", async () => {
    const src = program(`"/:x" -> Child`, `"/:y" -> Other, "/:x/*" -> Layout`).replace(
      "tile Child",
      `slot log : Text = ""\nreducer r on=route.enter("/:x") do= log := log + "+x;"\ntile Child`,
    );
    expect(check(parse(lex(src)))).toEqual([]);
    expect(await logAfter(src, navigateTo("/foo/bar"))).toBe("+x;");
  });
});
