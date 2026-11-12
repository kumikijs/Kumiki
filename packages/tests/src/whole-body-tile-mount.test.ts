import { type AppShape, renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { hydrateSource, mountSource, navigate, press } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

/** A `log` slot, and a reducer per name that records `+Name` on mount and `-Name` on unmount. */
const logging = (...names: string[]): string =>
  [
    "slot log : List(Text) = []",
    ...names.flatMap((n) => [
      `reducer sawMount${n} on=tile.mount(${n}) do= log := log.push("+${n}")`,
      `reducer sawUnmount${n} on=tile.unmount(${n}) do= log := log.push("-${n}")`,
    ]),
  ].join("\n");

/** A `show` slot and a `hide` button that clears it. */
const HIDE = `slot show : Bool = true
reducer hide on=ui.click(HideBtn) do= show := false
tile HideBtn = button(text="hide", onClick=hide)`;

describe("a tile whose whole body is another user tile mounts both", () => {
  it.each([
    {
      fires: "both, the outer tile first",
      names: ["Outer", "Inner"],
      tiles: `tile Inner = text("inner")
tile Outer = Inner`,
      top: "Outer",
      shown: ["+Outer", "+Inner"],
      left: ["-Outer", "-Inner"],
    },
    {
      fires: "every level of a chain, outermost first",
      names: ["A", "B", "C"],
      tiles: `tile C = text("c")
tile B = C
tile A = B`,
      top: "A",
      shown: ["+A", "+B", "+C"],
      left: ["-A", "-B", "-C"],
    },
  ])("fires mount for $fires, and unmount for each when it leaves", async (row) => {
    const { app, root } = await mountSource(
      withApp(`${logging(...row.names)}
${HIDE}
${row.tiles}
tile App = column(HideBtn, when(show, ${row.top}))`),
    );
    expect(app.live?.log).toEqual(row.shown);

    await press(root, "hide");
    expect(app.live?.log).toEqual([...row.shown, ...row.left]);
  });

  it("fires for both through keyed rows of an in= tile whose body calls another", async () => {
    // Losing one row leaves both tiles on screen in the others; clearing the list takes the last.
    const { app, root } = await mountSource(
      withApp(`${logging("Row", "Cell")}
slot items : List(Int) = [1, 2, 3]
reducer drop on=ui.click(DropBtn) do= items := [1, 3]
reducer clear on=ui.click(ClearBtn) do= items := []
tile DropBtn = button(text="drop", onClick=drop)
tile ClearBtn = button(text="clear", onClick=clear)
tile Cell in=Int = text("cell " + $1.show)
tile Row in=Int = Cell($1)
tile App = column(DropBtn, ClearBtn, column(for i in items Row(i)))`),
    );
    expect(root.textContent).toContain("cell 2");
    expect(app.live?.log).toEqual(["+Row", "+Cell"]);

    await press(root, "drop");
    expect(root.textContent).not.toContain("cell 2");
    expect(app.live?.log).toEqual(["+Row", "+Cell"]);

    await press(root, "clear");
    expect(app.live?.log).toEqual(["+Row", "+Cell", "-Row", "-Cell"]);
  });

  it("fires for both when the whole body is a for over calls of another tile", async () => {
    const { app, root } = await mountSource(
      withApp(`${logging("Outer", "Inner")}
slot items : List(Int) = [1, 2]
reducer clear on=ui.click(ClearBtn) do= items := []
tile ClearBtn = button(text="clear", onClick=clear)
tile Inner in=Int = text("inner " + $1.show)
tile Outer = for i in items Inner(i)
tile App = column(ClearBtn, column(Outer))`),
    );
    expect(app.live?.log).toEqual(["+Outer", "+Inner"]);

    await press(root, "clear");
    expect(app.live?.log).toEqual(["+Outer", "+Inner", "-Outer", "-Inner"]);
  });

  it("follows the branch a when or a match picks", async () => {
    // A `match` arm that is a builtin keeps `Outer` on screen, so only `Inner` leaves; a `when` that
    // turns off leaves `Outer` nothing to render, so `Gate` and `Outer` leave.
    const { app, root } = await mountSource(
      withApp(`${logging("Outer", "Inner", "Gate")}
${HIDE}
slot sel : Option(Int) = Some(1)
reducer clr on=ui.click(ClrBtn) do= sel := None
tile ClrBtn = button(text="clear", onClick=clr)
tile Inner = text("inner")
tile Outer = match sel with
    | Some(x) -> Inner
    | None -> text("none")
tile Gate = when(show, Outer)
tile App = column(HideBtn, ClrBtn, Gate)`),
    );
    expect(app.live?.log).toEqual(["+Gate", "+Outer", "+Inner"]);

    await press(root, "clear");
    expect(root.textContent).toContain("none");
    expect(app.live?.log).toEqual(["+Gate", "+Outer", "+Inner", "-Inner"]);

    await press(root, "hide");
    expect(app.live?.log).toEqual(["+Gate", "+Outer", "+Inner", "-Inner", "-Gate", "-Outer"]);
  });

  it.each([
    {
      leaves: "the standalone tile",
      app: "column(HideBtn, Outer, when(show, Inner))",
      after: ["+Outer", "+Inner"],
    },
    {
      leaves: "the tile whose whole body it is",
      app: "column(HideBtn, when(show, Outer), Inner)",
      after: ["+Outer", "+Inner", "-Outer"],
    },
  ])("keeps a tile mounted while it is still on screen, when $leaves leaves", async (row) => {
    const { app, root } = await mountSource(
      withApp(`${logging("Outer", "Inner")}
${HIDE}
tile Inner = text("inner")
tile Outer = Inner
tile App = ${row.app}`),
    );
    expect(app.live?.log).toEqual(["+Outer", "+Inner"]);

    await press(root, "hide");
    expect(root.textContent).toContain("inner");
    expect(app.live?.log).toEqual(row.after);
  });

  it.each([
    {
      between: "two whole-body tiles that share it",
      names: ["A", "B", "Inner"],
      tiles: `tile A = Inner
tile B = Inner`,
      some: "A",
      none: "B",
      shown: ["+A", "+Inner"],
      after: ["+A", "+Inner", "+B", "-A"],
    },
    {
      between: "a whole-body tile and the tile it is",
      names: ["Outer", "Inner"],
      tiles: "tile Outer = Inner",
      some: "Outer",
      none: "Inner",
      shown: ["+Outer", "+Inner"],
      after: ["+Outer", "+Inner", "-Outer"],
    },
  ])("keeps the shared tile mounted when a match switches between $between", async (row) => {
    const { app, root } = await mountSource(
      withApp(`${logging(...row.names)}
slot sel : Option(Int) = Some(1)
reducer clr on=ui.click(ClrBtn) do= sel := None
tile ClrBtn = button(text="clear", onClick=clr)
tile Inner = text("inner")
${row.tiles}
tile Pick = match sel with
    | Some(x) -> ${row.some}
    | None -> ${row.none}
tile App = column(ClrBtn, Pick)`),
    );
    expect(app.live?.log).toEqual(row.shown);

    await press(root, "clear");
    expect(root.textContent).toContain("inner");
    expect(app.live?.log).toEqual(row.after);
  });

  it.each([
    {
      where: "on a route target, and unmounts both when the route changes",
      src: `${logging("Outer", "Inner", "Other")}
tile Inner = text("inner")
tile Outer = Inner
tile Other = text("other")
app M caps=[] routes={"/" -> Outer, "/other" -> Other, "/404" -> Other} init=[]`,
      from: "/",
      to: "/other",
      shown: ["+Outer", "+Inner"],
      after: ["+Outer", "+Inner", "+Other", "-Outer", "-Inner"],
    },
    {
      where: "on a sub-routes child",
      src: `${logging("Shell", "Panel", "Inner", "Other")}
tile Inner = text("inner")
tile Panel = Inner
tile Other = text("other")
tile Shell sub-routes={"/shell/a" -> Panel, "/shell/b" -> Other} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> Other} init=[]`,
      from: "/shell/a",
      to: "/shell/b",
      shown: ["+Shell", "+Panel", "+Inner"],
      after: ["+Shell", "+Panel", "+Inner", "+Other", "-Panel", "-Inner"],
    },
  ])("fires for both $where", async ({ src, from, to, shown, after }) => {
    const { app } = await mountSource(`${src}\n`, from);
    expect(app.live?.log).toEqual(shown);

    await navigate(app, to);
    expect(app.live?.log).toEqual(after);
  });

  it("fires for both when an error-boundary fallback's body is a user tile", async () => {
    const { app, root } = await mountSource(
      withApp(`${logging("Oops", "Inner", "Boom")}
slot broken : Bool = true
reducer fix on=ui.click(FixBtn) do= broken := false
tile FixBtn = button(text="fix", onClick=fix)
tile Inner = text("inner")
tile Oops in=PanicInfo = Inner
tile Boom error-boundary=Oops = column(when(broken, text(panic("bang"))), text("boom ok"))
tile App = column(FixBtn, Boom)`),
    );
    expect(root.textContent).toContain("inner");
    expect(app.live?.log).toEqual(["+Oops", "+Inner"]);

    await press(root, "fix");
    expect(root.textContent).toContain("boom ok");
    expect(app.live?.log).toEqual(["+Oops", "+Inner", "+Boom", "-Oops", "-Inner"]);
  });

  // While the boundary shows its fallback, the node is the whole tree of the wrapping tile and the
  // fallback, so those two fire and the tile declaring the boundary does not.
  it.each([
    {
      where: "at a call site",
      names: ["Outer", "Boom", "Oops"],
      src: withApp(`slot broken : Bool = true
reducer fix on=ui.click(FixBtn) do= broken := false
tile FixBtn = button(text="fix", onClick=fix)
tile Oops in=PanicInfo = text("oops")
tile Boom error-boundary=Oops = column(when(broken, text(panic("bang"))), text("boom ok"))
tile Outer = Boom
tile App = column(FixBtn, Outer)`),
      leave: (_app: AppShape, root: HTMLElement) => press(root, "fix"),
      shown: ["+Outer", "+Oops"],
      after: ["+Outer", "+Oops", "+Boom", "-Oops"],
    },
    {
      where: "as a route target",
      names: ["Page", "Boom", "Oops", "Other"],
      src: `tile Oops in=PanicInfo = text("oops")
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile Page = Boom
tile Other = text("other")
app M caps=[] routes={"/" -> Page, "/other" -> Other, "/404" -> Other} init=[]`,
      leave: (app: AppShape) => navigate(app, "/other"),
      shown: ["+Page", "+Oops"],
      after: ["+Page", "+Oops", "+Other", "-Page", "-Oops"],
    },
    {
      where: "as a for row",
      names: ["Row", "Cell", "Oops"],
      src: withApp(`slot items : List(Int) = [1, 2, 3]
reducer drop on=ui.click(DropBtn) do= items := [1, 3]
tile DropBtn = button(text="drop", onClick=drop)
tile Oops in=PanicInfo = text("oops")
tile Cell in=Int error-boundary=Oops = column(when($1 == 2, text(panic("two"))), text("cell " + $1.show))
tile Row in=Int = Cell($1)
tile App = column(DropBtn, column(for i in items Row(i)))`),
      leave: (_app: AppShape, root: HTMLElement) => press(root, "drop"),
      shown: ["+Row", "+Cell", "+Oops"],
      after: ["+Row", "+Cell", "+Oops", "-Oops"],
    },
  ])("fires a fallback's mount and unmount when the tile declaring the boundary is another tile's whole body, $where", async ({
    names,
    src,
    leave,
    shown,
    after,
  }) => {
    const { app, root } = await mountSource(`${logging(...names)}\n${src}\n`);
    expect(root.textContent).toContain("oops");
    expect(app.live?.log).toEqual(shown);

    await leave(app, root);
    expect(root.textContent).not.toContain("oops");
    expect(app.live?.log).toEqual(after);
  });

  it("keeps the element and fires nothing again when the tree re-renders", async () => {
    const { app, root } = await mountSource(
      withApp(`${logging("Outer", "Inner")}
slot n : Int = 0
reducer bump on=ui.click(BumpBtn) do= n := n + 1
tile BumpBtn = button(text="bump", onClick=bump)
tile Inner = text("inner " + n.show) {test-id: "inner"}
tile Outer = Inner
tile App = column(BumpBtn, Outer)`),
    );
    const before = root.querySelector('[data-kumiki-test="inner"]');
    expect(before?.textContent).toBe("inner 0");

    await press(root, "bump");
    await press(root, "bump");
    const after = root.querySelector('[data-kumiki-test="inner"]');
    expect(after?.textContent).toBe("inner 2");
    expect(after).toBe(before);
    expect(app.live?.log).toEqual(["+Outer", "+Inner"]);
  });

  it("serves the same HTML as the tree written out, and hydration fires each mount once", async () => {
    // The marker is never rendered, so the server's HTML is that of the same tree with no user tiles;
    // the client's first render is where both tiles are first seen.
    const src = withApp(
      `${logging("Outer", "Inner")}
tile Inner = text("inner")
tile Outer = Inner
tile Home = column(text("home"), Outer)`,
      "Home",
    );
    const written = withApp(`tile Home = column(text("home"), text("inner"))`, "Home");
    const plain = await renderToString(await loadSource(written), { route: "/", routing });

    const { app, root, html } = await hydrateSource(src);
    expect(html).toContain("inner");
    expect(html).toBe(plain.html);
    expect(root.textContent).toContain("inner");
    expect(app.live?.log).toEqual(["+Outer", "+Inner"]);
  });
});
