// A tile whose whole body is another user tile puts both on screen.
//
// lifecycle.md §7.1.6 defines `tile.mount(X)` / `tile.unmount(X)` as X
// appearing in / disappearing from the DOM, and the runtime diffs them against
// the `_named(…)` markers in the rendered tree. `tile Outer = Inner` renders
// one tree that is the whole of both, so that tree carries both names, outer
// first: both mount, `Outer`'s first, and both unmount when it leaves. The
// same holds at any depth and in every position a tile renders in — a call
// site, a `for` row, a `when` / `match` branch, a route target, a `sub-routes`
// child and an `error-boundary` fallback.
//
// Each program records its events in `log`, so a test pins which tiles fired
// and in what order. Runtime-truth throughout: `check` and `build` are green
// either way.

import { hydrate, mount, renderToString, routing } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Navigable = { _navigate: (path: string, replace?: boolean) => void };

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
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const start = async (src: string, initialPath = "/") => {
    const app = await loadSource(src);
    mountedRoot = document.createElement("div");
    document.body.appendChild(mountedRoot);
    const { dispose } = mount(app, mountedRoot, { router: "memory", initialPath });
    disposeFn = dispose;
    await tick();
    const root = mountedRoot;
    const live = app.live as Record<string, unknown>;
    const click = async (label: string): Promise<void> => {
      const button = [...root.querySelectorAll("button")].find((b) => b.textContent === label);
      if (!button) throw new Error(`no button "${label}" in: ${root.textContent}`);
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await tick();
    };
    const navigate = async (path: string): Promise<void> => {
      (app as typeof app & Navigable)._navigate(path, false);
      await tick();
    };
    return { root, live, click, navigate };
  };

  it("fires mount for both, the outer tile first, and unmount for both when it leaves", async () => {
    const { root, live, click } = await start(`${logging("Outer", "Inner")}
${HIDE}
tile Inner = text("inner")
tile Outer = Inner
tile App = column(HideBtn, when(show, Outer))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("inner");
    expect(live.log).toEqual(["+Outer", "+Inner"]);

    await click("hide");
    expect(root.textContent).not.toContain("inner");
    expect(live.log).toEqual(["+Outer", "+Inner", "-Outer", "-Inner"]);
  });

  it("fires for every level of a chain, outermost first", async () => {
    const { live, click } = await start(`${logging("A", "B", "C")}
${HIDE}
tile C = text("c")
tile B = C
tile A = B
tile App = column(HideBtn, when(show, A))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(live.log).toEqual(["+A", "+B", "+C"]);

    await click("hide");
    expect(live.log).toEqual(["+A", "+B", "+C", "-A", "-B", "-C"]);
  });

  it("fires for both through keyed rows of an in= tile whose body calls another", async () => {
    // Each row is the whole tree of a `Row` and of the `Cell` it calls. Losing
    // one row leaves both tiles on screen in the others; clearing the list
    // takes the last of each.
    const { root, live, click } = await start(`${logging("Row", "Cell")}
slot items : List(Int) = [1, 2, 3]
reducer drop on=ui.click(DropBtn) do= items := [1, 3]
reducer clear on=ui.click(ClearBtn) do= items := []
tile DropBtn = button(text="drop", onClick=drop)
tile ClearBtn = button(text="clear", onClick=clear)
tile Cell in=Int = text("cell " + $1.show)
tile Row in=Int = Cell($1)
tile App = column(DropBtn, ClearBtn, column(for i in items Row(i)))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("cell 2");
    expect(live.log).toEqual(["+Row", "+Cell"]);

    await click("drop");
    expect(root.textContent).not.toContain("cell 2");
    expect(live.log).toEqual(["+Row", "+Cell"]);

    await click("clear");
    expect(live.log).toEqual(["+Row", "+Cell", "-Row", "-Cell"]);
  });

  it("fires for both when the whole body is a for over calls of another tile", async () => {
    const { live, click } = await start(`${logging("Outer", "Inner")}
slot items : List(Int) = [1, 2]
reducer clear on=ui.click(ClearBtn) do= items := []
tile ClearBtn = button(text="clear", onClick=clear)
tile Inner in=Int = text("inner " + $1.show)
tile Outer = for i in items Inner(i)
tile App = column(ClearBtn, column(Outer))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(live.log).toEqual(["+Outer", "+Inner"]);

    await click("clear");
    expect(live.log).toEqual(["+Outer", "+Inner", "-Outer", "-Inner"]);
  });

  it("follows the branch a when or a match picks", async () => {
    // `Outer` stays on screen through a `match` whose other arm is a builtin,
    // so only `Inner` leaves; a `when` that turns off leaves `Outer` with
    // nothing to render, so both leave.
    const { root, live, click } = await start(`${logging("Outer", "Inner", "Gate")}
${HIDE}
slot sel : Option(Int) = Some(1)
reducer clr on=ui.click(ClrBtn) do= sel := None
tile ClrBtn = button(text="clear", onClick=clr)
tile Inner = text("inner")
tile Outer = match sel with
    | Some(x) -> Inner
    | None -> text("none")
tile Gate = when(show, Outer)
tile App = column(HideBtn, ClrBtn, Gate)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(live.log).toEqual(["+Gate", "+Outer", "+Inner"]);

    await click("clear");
    expect(root.textContent).toContain("none");
    expect(live.log).toEqual(["+Gate", "+Outer", "+Inner", "-Inner"]);

    await click("hide");
    expect(live.log).toEqual(["+Gate", "+Outer", "+Inner", "-Inner", "-Gate", "-Outer"]);
  });

  it("keeps a tile mounted while it is still another tile's whole body", async () => {
    // `Inner` is on screen twice — on its own and as `Outer`'s whole body — so
    // removing the one on its own leaves it on screen, and nothing fires.
    const { root, live, click } = await start(`${logging("Outer", "Inner")}
${HIDE}
tile Inner = text("inner")
tile Outer = Inner
tile App = column(HideBtn, Outer, when(show, Inner))
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(live.log).toEqual(["+Outer", "+Inner"]);

    await click("hide");
    expect(root.textContent).toContain("inner");
    expect(live.log).toEqual(["+Outer", "+Inner"]);
  });

  it("fires for both on a route target, and unmounts both when the route changes", async () => {
    const { live, navigate } = await start(`${logging("Outer", "Inner", "Other")}
tile Inner = text("inner")
tile Outer = Inner
tile Other = text("other")
app M caps=[] routes={"/" -> Outer, "/other" -> Other, "/404" -> Other} init=[]
`);
    expect(live.log).toEqual(["+Outer", "+Inner"]);

    await navigate("/other");
    expect(live.log).toEqual(["+Outer", "+Inner", "+Other", "-Outer", "-Inner"]);
  });

  it("fires for both on a sub-routes child", async () => {
    const { live, navigate } = await start(
      `${logging("Shell", "Panel", "Inner", "Other")}
tile Inner = text("inner")
tile Panel = Inner
tile Other = text("other")
tile Shell sub-routes={"/shell/a" -> Panel, "/shell/b" -> Other} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> Other} init=[]
`,
      "/shell/a",
    );
    expect(live.log).toEqual(["+Shell", "+Panel", "+Inner"]);

    await navigate("/shell/b");
    expect(live.log).toEqual(["+Shell", "+Panel", "+Inner", "+Other", "-Panel", "-Inner"]);
  });

  it("fires for both when an error-boundary fallback's body is a user tile", async () => {
    const { root, live, click } = await start(`${logging("Oops", "Inner", "Boom")}
slot broken : Bool = true
reducer fix on=ui.click(FixBtn) do= broken := false
tile FixBtn = button(text="fix", onClick=fix)
tile Inner = text("inner")
tile Oops in=PanicInfo = Inner
tile Boom error-boundary=Oops = column(when(broken, text(panic("bang"))), text("boom ok"))
tile App = column(FixBtn, Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("inner");
    expect(live.log).toEqual(["+Oops", "+Inner"]);

    await click("fix");
    expect(root.textContent).toContain("boom ok");
    expect(live.log).toEqual(["+Oops", "+Inner", "+Boom", "-Oops", "-Inner"]);
  });

  it("keeps the element and fires nothing again when the tree re-renders", async () => {
    const { root, live, click } = await start(`${logging("Outer", "Inner")}
slot n : Int = 0
reducer bump on=ui.click(BumpBtn) do= n := n + 1
tile BumpBtn = button(text="bump", onClick=bump)
tile Inner = text("inner " + n.show) {test-id: "inner"}
tile Outer = Inner
tile App = column(BumpBtn, Outer)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    const before = root.querySelector('[data-kumiki-test="inner"]');
    expect(before?.textContent).toBe("inner 0");

    await click("bump");
    await click("bump");
    const after = root.querySelector('[data-kumiki-test="inner"]');
    expect(after?.textContent).toBe("inner 2");
    expect(after).toBe(before);
    expect(live.log).toEqual(["+Outer", "+Inner"]);
  });

  it("serves the same HTML as the tree written out, and hydration fires each mount once", async () => {
    // The marker is a prop the DOM never shows: the server's HTML is that of
    // the same tree with no user tiles in it. What it changes is the client's
    // first render, where both tiles are first seen on the client.
    const src = `${logging("Outer", "Inner")}
tile Inner = text("inner")
tile Outer = Inner
tile Home = column(text("home"), Outer)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`;
    const written = `tile Home = column(text("home"), text("inner"))
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`;
    const rendered = await renderToString(await loadSource(src), { route: "/", routing });
    const plain = await renderToString(await loadSource(written), { route: "/", routing });
    expect(rendered.html).toContain("inner");
    expect(rendered.html).toBe(plain.html);

    const app = await loadSource(src);
    mountedRoot = document.createElement("div");
    mountedRoot.innerHTML = rendered.html;
    document.body.appendChild(mountedRoot);
    const { dispose } = hydrate(app, mountedRoot, rendered, { router: "memory" });
    disposeFn = dispose;
    await tick();
    expect(mountedRoot.textContent).toContain("inner");
    expect((app.live as Record<string, unknown>).log).toEqual(["+Outer", "+Inner"]);
  });
});
