import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

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
    // Nothing renders a tile written as a named argument.
    ["an outlet in a named argument", ``, `page(column(x=when(true, route-outlet())))`],
    ["a helper in a named argument", OUTLET, `page(column(x=Outlet))`],
  ])("reports %s as E0113", (_, defs, body) => {
    expect(codes(defs, body)).toEqual(["E0113"]);
  });

  // These builtins drop their positional arguments, which E0129 reports at the argument.
  it.each([
    ["an outlet under a spinner", ``, `page(spinner(route-outlet()))`],
    ["a helper under a spinner", OUTLET, `page(heading("s"), spinner(Outlet))`],
    ["a helper under a button", OUTLET, `page(button(text="go", Outlet))`],
  ])("reports %s as E0113, beside the E0129", (_, defs, body) => {
    expect(codes(defs, body)).toEqual(["E0129", "E0113"]);
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
