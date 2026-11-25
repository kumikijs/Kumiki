import { readFileSync } from "node:fs";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf, messagesOf, textAt } from "./helpers/diagnostics.ts";

describe("sub-routes", () => {
  const nested = (parentPath: string, extra = "") => `
    tile NotFound = page(heading("404"))
    tile Account = page(heading("account"))
    tile SettingsHome = page(heading("home"))
    tile SettingsLayout
      sub-routes = {
        "/settings/account" -> Account,
        "/settings"         -> SettingsHome${extra}
      }
      = page(route-outlet())
    app A caps=[] routes={
      "${parentPath}" -> SettingsLayout,
      "/404" -> NotFound
    } init=[]
  `;

  it("accepts a wildcard parent with valid sub-routes", () => {
    expect(checkSource(nested("/settings/*"))).toEqual([]);
  });

  it("reports an undefined sub-route target as E0105", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Layout sub-routes = { "/x" -> Missing } = page(route-outlet())
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0105" && e.message.includes("Missing"))).toBe(true);
  });

  it("reports a non-wildcard parent as E0114", () => {
    const errors = checkSource(nested("/settings"));
    expect(
      errors.some((e) => e.code === "E0114" && e.kind === "sub-routes-without-wildcard-parent"),
    ).toBe(true);
  });

  it("reports orphan sub-routes (tile not reachable from app.routes) as E0111", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Orphan sub-routes = { "/x" -> Account } = page(route-outlet())
      tile App = page(heading("root"))
      app A caps=[] routes={ "/" -> App, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0111" && e.kind === "orphan-sub-routes")).toBe(true);
  });

  it("reports duplicate sub-route paths as E0112", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Layout
        sub-routes = {
          "/x/a" -> Account,
          "/x/a" -> Account
        }
        = page(route-outlet())
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0112" && e.kind === "duplicate-sub-route")).toBe(true);
  });

  it("reports a parent that renders no route-outlet as E0113", () => {
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("a"))
      tile Layout
        sub-routes = { "/x/a" -> Account }
        = page(heading("settings"))
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0113" && e.kind === "sub-routes-without-outlet")).toBe(
      true,
    );
  });
});

describe("E0113 reads the tiles the body renders", () => {
  const program = (defs: string, body: string, routes = "") => `
    tile NotFound = page(heading("404"))
    tile Account = page(heading("account"))
    ${defs}
    tile Layout
      sub-routes = { "/x/a" -> Account }
      = ${body}
    app A caps=[] routes={ "/x/*" -> Layout, ${routes}"/404" -> NotFound } init=[]
  `;
  const codes = (defs: string, body: string) => codesOf(program(defs, body));

  it.each<[string, string, string, string?]>([
    ["named bare", `tile Outlet = column(route-outlet())`, `page(heading("s"), Outlet)`],
    ["called", `tile Outlet = column(route-outlet())`, `page(heading("s"), Outlet())`],
    [
      "more than one tile down",
      `tile Inner = column(route-outlet())
       tile Middle = row(Inner())
       tile Outlet = column(Middle)`,
      `page(Outlet)`,
    ],
    [
      "named as the child of a builtin container",
      `tile Outlet = column(route-outlet())`,
      `page(card(Outlet))`,
    ],
    [
      "that takes an input",
      `tile Frame in=Text = column(heading($1), route-outlet())`,
      `page(Frame("s"))`,
    ],
    [
      "that declares sub-routes of its own",
      `tile InnerChild = page(heading("inner"))
       tile Inner sub-routes = { "/y/a" -> InnerChild } = column(route-outlet())`,
      `page(Inner)`,
      `"/y/*" -> Inner, `,
    ],
    ["that is the whole body, named bare", `tile Outlet = column(route-outlet())`, `Outlet`],
    ["that is the whole body, called", `tile Outlet = column(route-outlet())`, `Outlet()`],
    // The bare name is the program's tile, as the build renders it, not the builtin `spinner`.
    [
      "named like a builtin, written bare",
      `slot spinner : Text = "s"
       tile spinner = column(route-outlet())`,
      `page(heading("s"), spinner)`,
    ],
  ])("accepts an outlet in a tile %s", (_, defs, body, routes) => {
    expect(checkSource(program(defs, body, routes))).toEqual([]);
  });

  const SHOWN = `slot shown : Bool = true`;
  const OPT = `slot o : Option(Int) = None`;

  it.each([
    ["a when, inline", SHOWN, `page(column(when(shown, route-outlet())))`],
    [
      "a when, in a helper",
      `${SHOWN}\ntile Outlet = column(when(shown, route-outlet()))`,
      `page(Outlet)`,
    ],
    ["an if, inline", SHOWN, `page(if shown then column(route-outlet()) else column(text("x")))`],
    [
      "an if, in a helper",
      `${SHOWN}\ntile Outlet = if shown then column(route-outlet()) else column(text("x"))`,
      `page(Outlet)`,
    ],
    [
      "a match, inline",
      OPT,
      `page(match o with | Some(n) -> column(route-outlet()) | None -> column(text("x")))`,
    ],
    [
      "a match, in a helper",
      `${OPT}\ntile Outlet = match o with | Some(n) -> column(route-outlet()) | None -> column(text("x"))`,
      `page(Outlet)`,
    ],
    ["a for, inline", ``, `page(column(for i in [1] route-outlet()))`],
    ["a for, in a helper", `tile Outlet = column(for i in [1] route-outlet())`, `page(Outlet)`],
  ])("accepts an outlet under %s", (_, defs, body) => {
    expect(checkSource(program(defs, body))).toEqual([]);
  });

  const OUTLET = `tile Outlet = column(route-outlet())`;

  it.each([
    ["a helper with no outlet", `tile Helper = column(text("h"))`, `page(Helper)`],
  ])("reports %s as E0113", (_, defs, body) => {
    expect(codes(defs, body)).toEqual(["E0113"]);
  });

  it("reports an outlet in a named argument as E0113, beside the E0201 at the when", () => {
    expect(codes(``, `page(column(x=when(true, route-outlet())))`)).toEqual(["E0201", "E0113"]);
  });

  // These builtins drop their positional arguments, which E0129 reports at the argument.
  it.each([
    ["an outlet under a spinner", ``, `page(spinner(route-outlet()))`],
    ["a helper under a spinner", OUTLET, `page(heading("s"), spinner(Outlet))`],
    ["a helper under a button", OUTLET, `page(button(text="go", Outlet))`],
  ])("reports %s as E0113, beside the E0129", (_, defs, body) => {
    expect(codes(defs, body)).toEqual(["E0129", "E0113"]);
  });

  it("reports a helper in a named argument as E0113, its name as E0116", () => {
    // Written as a value, a tile's name is a variant tag no union declares.
    expect(codes(OUTLET, `page(column(x=Outlet))`)).toEqual(["E0116", "E0113"]);
  });

  it("reports an outlet only in the sub-route target as E0113", () => {
    // The target renders in the parent's outlet; the parent does not render it.
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("account"), route-outlet())
      tile Layout
        sub-routes = { "/x/a" -> Account }
        = page(heading("s"))
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    expect(codesOf(src)).toEqual(["E0113"]);
  });

  it("reports an outlet only in the tile's own error-boundary fallback as E0113", () => {
    // The runtime fills the outlet inside the boundary, in the tree the fallback replaces.
    const src = `
      tile NotFound = page(heading("404"))
      tile Account = page(heading("account"))
      tile Fb in=PanicInfo = column(route-outlet())
      tile Layout
        error-boundary = Fb
        sub-routes = { "/x/a" -> Account }
        = page(heading("s"))
      app A caps=[] routes={ "/x/*" -> Layout, "/404" -> NotFound } init=[]
    `;
    expect(codesOf(src)).toContain("E0113");
  });

  it("reports an outlet only in a rendered tile's error-boundary fallback as E0113", () => {
    const fallback = `tile Fb in=PanicInfo = column(route-outlet())
      tile Helper error-boundary=Fb = column(text("h"))`;
    expect(codes(fallback, `page(Helper())`)).toEqual(["E0113"]);
  });

  it("terminates on a helper that expands into itself, and still reports E0113", () => {
    expect(codes(`tile Loop = column(text("x"), Loop)`, `page(Loop)`).sort()).toEqual([
      "E0005",
      "E0113",
    ]);
  });

  it("says what it looked at", () => {
    const err = checkSource(program(`tile Helper = column(text("h"))`, `page(Helper)`)).find(
      (e) => e.code === "E0113",
    );
    expect(err?.message).toBe(
      `Tile "Layout" declares sub-routes but renders no "route-outlet", in its body or in any tile it renders — the matched child would have nowhere to render`,
    );
  });
});

describe("W0218: a sub-route a more specific sibling takes every path of", () => {
  const SHADOWED = readFileSync(feature("265-shadowed-sub-route"), "utf8");

  it("warns at the key, naming the sibling, the parent and the reducer that never runs", () => {
    const found = checkSource(SHADOWED);
    expect(found.map((e) => [e.code, e.kind, e.severity])).toEqual([
      ["W0218", "shadowed-sub-route", "warning"],
    ]);
    expect(textAt(SHADOWED, found[0]?.pos ?? { line: 0, col: 0 })).toBe(
      `"/settings/account" -> Account,`,
    );
    expect(found[0]?.message).toBe(
      `Sub-route "/settings/account" in tile "Layout" is never matched: every path it matches is matched by "/settings/:section" in app.routes, which ranks ahead of its parent "/settings/*", so the router renders that route there, without the parent. Reducer "enterAccount" subscribes to it and never runs`,
    );
  });

  /** `children` are the sub-routes of the tile `routes` reach as `Layout`. */
  const program = (children: string, routes: string) => `
    tile Child = page(heading("child"))
    tile Other = page(heading("other"))
    tile Home = page(heading("home"))
    tile NotFound = page(heading("404"))
    tile Layout sub-routes = {${children}} = page(route-outlet())
    app A caps=[] routes={"/" -> Home, ${routes}, "/404" -> NotFound} init=[]
  `;

  it.each<[string, string, string, string]>([
    [
      "a parameter sibling",
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/settings/:section" -> Other`,
      "/settings/:section",
    ],
    [
      "a static sibling at the same path",
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
      "/settings/account",
    ],
    [
      "a wildcard sibling more specific than a root parent",
      `"/settings/account" -> Child`,
      `"/*" -> Layout, "/settings/*" -> Other`,
      "/settings/*",
    ],
    [
      "a parameter sibling, over a parameter child",
      `"/settings/:tab" -> Child`,
      `"/settings/*" -> Layout, "/settings/:section" -> Other`,
      "/settings/:section",
    ],
    [
      "a redirect sibling",
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/settings/:section" ->> "/"`,
      "/settings/:section",
    ],
    [
      "a sibling that ties with the parent and is declared first",
      `"/x/y" -> Child`,
      `"/:a/*" -> Other, "/:b/*" -> Layout`,
      "/:a/*",
    ],
    [
      "a parameter sibling, over a redirect child",
      `"/settings/old" ->> "/"`,
      `"/settings/*" -> Layout, "/settings/:section" -> Other`,
      "/settings/:section",
    ],
    [
      "a sibling that takes every path of a default child's parent",
      `"/:b" -> Child`,
      `"/:a/*" -> Other, "/:b/*" -> Layout`,
      "/:a/*",
    ],
    [
      "a static sibling, over a redirect at the parent's bare path, which is no default child",
      `"/settings" ->> "/"`,
      `"/settings" -> Other, "/settings/*" -> Layout`,
      "/settings",
    ],
  ])("reports a child shadowed by %s", (_, children, routes, sibling) => {
    const src = program(children, routes);
    expect(codesOf(src)).toEqual(["W0218"]);
    expect(messagesOf(src)[0]).toContain(`is matched by "${sibling}" in app.routes`);
  });

  it.each<[string, string, string]>([
    [
      "a wildcard child the sibling takes only part of",
      `"/settings/*" -> Child`,
      `"/settings/*" -> Layout, "/settings/:section" -> Other`,
    ],
    [
      "a bare child a two-segment sibling does not match",
      `"/settings" -> Child`,
      `"/settings/*" -> Layout, "/settings/:section" -> Other`,
    ],
    [
      "a parameter child a static sibling takes one path of",
      `"/settings/:tab" -> Child`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
    ],
    [
      "a child whose covering sibling ranks after the parent",
      `"/settings" -> Child`,
      `"/settings/*" -> Layout, "/:lang" -> Other`,
    ],
    [
      "a child whose sibling ties with the parent and is declared after it",
      `"/x/y" -> Child`,
      `"/:b/*" -> Layout, "/:a/*" -> Other`,
    ],
    [
      "a child the more specific of two parents takes",
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/:x/*" -> Layout`,
    ],
    [
      "a default child at the root, beside a top-level route at its own path",
      `"/about" -> Other, "/" -> Child`,
      `"/*" -> Layout`,
    ],
    [
      "a default child beside a static sibling at its own path",
      `"/settings" -> Child`,
      `"/settings" -> Other, "/settings/*" -> Layout`,
    ],
    [
      "a default child beside a parameter sibling that matches every path the key does",
      `"/:x" -> Child`,
      `"/:y" -> Other, "/:x/*" -> Layout`,
    ],
  ])("accepts %s", (_, children, routes) => {
    expect(checkSource(program(children, routes))).toEqual([]);
  });

  it("names no reducer on a default child, whose route events fire at its parent's other paths", () => {
    const src = program(`"/:x" -> Child`, `"/:y" -> Other, "/:x/*" -> Layout`).replace(
      "tile Child",
      `slot log : Text = ""\n    reducer r on=route.enter("/:x") do= log := log + "+x;"\n    tile Child`,
    );
    expect(checkSource(src)).toEqual([]);
  });

  it("reports a child written at /404, which matches no path, as E0001 alone", () => {
    const found = checkSource(program(`"/404" -> Child`, `"/*" -> Layout, "/:page" -> Other`));
    expect(found.map((d) => [d.code, d.kind])).toEqual([["E0001", "404-in-sub-routes"]]);
  });

  it("names both parents of a tile two routes target, when one entry ranks ahead of both", () => {
    const src = program(
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/prefs/*" -> Layout, "/settings/:section" -> Other`,
    );
    expect(codesOf(src)).toEqual(["W0218"]);
    expect(messagesOf(src)[0]).toContain(`ranks ahead of its parents "/settings/*", "/prefs/*"`);
  });

  it("names no reducer when a top-level route at the same key still fires it", () => {
    const src = program(
      `"/settings/account" -> Child`,
      `"/settings/*" -> Layout, "/settings/account" -> Other`,
    ).replace(
      "tile Child",
      `slot n : Int = 0\n    reducer r on=route.enter("/settings/account") do= n := 1\n    tile Child`,
    );
    expect(codesOf(src)).toEqual(["W0218"]);
    expect(messagesOf(src)[0]).not.toContain("Reducer");
  });

  it("leaves a misspelt subscription to E0228, and names it nowhere in the warning", () => {
    const src = SHADOWED.replace(
      'route.enter("/settings/account")',
      'route.enter("/settings/acount")',
    );
    expect(codesOf(src).sort()).toEqual(["E0228", "W0218"]);
    expect(checkSource(src).find((e) => e.code === "W0218")?.message).not.toContain("Reducer");
  });
});
