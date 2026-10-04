// An `error-boundary` fallback is a tile on screen, so it mounts and unmounts.
//
// lifecycle.md §7.1.6 defines `tile.mount(X)` / `tile.unmount(X)` as X
// appearing in / disappearing from the DOM, and the runtime diffs them against
// the `_named(…, "X")` markers in the rendered tree. A fallback appears when
// its boundary catches a panic, wherever the boundary is declared — at a call
// site, on a route target, on a `sub-routes` parent — so its tree carries the
// marker in every one of those positions, and leaves with it.
//
// The tile that panicked is the other half: its tree is what the boundary
// discarded, so its own `tile.mount` does not fire while the fallback stands
// in for it (pinned in route-root-tile.test.ts, for both positions).
//
// Runtime-truth throughout: `check` and `build` are green either way.

import { hydrate, mount, renderToString, routing } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Navigable = { _navigate: (path: string, replace?: boolean) => void };

describe("an error-boundary fallback fires tile.mount and tile.unmount", () => {
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

  /** Counts both events for `Oops`, the fallback every program here declares. */
  const COUNTS = `slot fbMounts : Int = 0
slot fbUnmounts : Int = 0
reducer sawFbMount on=tile.mount(Oops) do= fbMounts := fbMounts + 1
reducer sawFbUnmount on=tile.unmount(Oops) do= fbUnmounts := fbUnmounts + 1`;

  it("fires mount for a fallback at a call site, beside a sibling tile's", async () => {
    const { root, live } = await start(`slot fallbackMounts : Int = 0
slot okMounts : Int = 0
reducer sawFallback on=tile.mount(Oops) do= fallbackMounts := fallbackMounts + 1
reducer sawOk on=tile.mount(Fine) do= okMounts := okMounts + 1
tile Oops in=PanicInfo = text("oops fallback")
tile Fine = text("fine child")
tile Boom
    error-boundary = Oops
    = column(text(panic("bang")))
tile Home = page(Fine, Boom, text("fallbackMounts=" + fallbackMounts.show + " okMounts=" + okMounts.show))
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`);
    expect(root.textContent).toContain("oops fallback");
    expect(root.textContent).toContain("fine child");
    expect(live.fallbackMounts).toBe(1);
    expect(live.okMounts).toBe(1);
  });

  it("fires mount once while the fallback re-renders, and unmount when the tile recovers", async () => {
    // A re-render with the panic still there is the same fallback on screen,
    // not a new appearance. When the tile renders its own body again the
    // fallback leaves (unmount) and the tile itself arrives (mount); breaking
    // it again brings the fallback back, which is a new appearance.
    const { root, live, click } = await start(`${COUNTS}
slot broken : Bool = true
slot n : Int = 0
slot boomMounts : Int = 0
slot boomUnmounts : Int = 0
reducer sawBoomMount on=tile.mount(Boom) do= boomMounts := boomMounts + 1
reducer sawBoomUnmount on=tile.unmount(Boom) do= boomUnmounts := boomUnmounts + 1
reducer fix on=ui.click(FixBtn) do= broken := false
reducer brk on=ui.click(BreakBtn) do= broken := true
reducer bump on=ui.click(BumpBtn) do= n := n + 1
tile FixBtn = button(text="fix", onClick=fix)
tile BreakBtn = button(text="break", onClick=brk)
tile BumpBtn = button(text="bump", onClick=bump)
tile Oops in=PanicInfo = text("oops " + $1.message + " n=" + n.show)
tile Boom error-boundary=Oops = column(when(broken, text(panic("bang"))), text("boom ok"))
tile Home = page(FixBtn, BreakBtn, BumpBtn, Boom)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`);
    expect(live.fbMounts).toBe(1);

    await click("bump");
    await click("bump");
    expect(root.textContent).toContain("oops bang n=2");
    expect(live.fbMounts).toBe(1);
    expect(live.fbUnmounts).toBe(0);

    await click("fix");
    expect(root.textContent).toContain("boom ok");
    expect(live.fbUnmounts).toBe(1);
    expect(live.boomMounts).toBe(1);

    await click("break");
    expect(root.textContent).toContain("oops bang");
    expect(live.fbMounts).toBe(2);
    expect(live.boomUnmounts).toBe(1);
  });

  it("fires mount and unmount for a fallback on a route target", async () => {
    const { root, live, navigate } = await start(`${COUNTS}
tile Oops in=PanicInfo = text("oops")
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile Other = text("other")
app M caps=[] routes={"/" -> Boom, "/other" -> Other, "/404" -> Other} init=[]
`);
    expect(root.textContent).toContain("oops");
    expect(live.fbMounts).toBe(1);

    await navigate("/other");
    expect(root.textContent).toContain("other");
    expect(live.fbUnmounts).toBe(1);
  });

  it("fires mount and unmount for a sub-routes parent's fallback over a panicking child", async () => {
    const { root, live, navigate } = await start(
      `${COUNTS}
tile Oops in=PanicInfo = text("oops at " + $1.location)
tile Child = column(text(panic("bang")))
tile Healthy = text("healthy child")
tile NotFound = text("nf")
tile Shell error-boundary=Oops sub-routes={"/shell/a" -> Child, "/shell/b" -> Healthy} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("oops at Child");
    expect(live.fbMounts).toBe(1);

    await navigate("/shell/b");
    expect(root.textContent).toContain("healthy child");
    expect(live.fbUnmounts).toBe(1);
  });

  it("fires unmount when the row showing the fallback leaves a for", async () => {
    // The fallback stands where a keyed row was; dropping the row takes the
    // fallback out of the tree with it.
    const { root, live, click } = await start(`${COUNTS}
slot items : List(Int) = [1, 2, 3]
reducer drop on=ui.click(DropBtn) do= items := [1, 3]
tile DropBtn = button(text="drop", onClick=drop)
tile Oops in=PanicInfo = text("oops " + $1.message)
tile Cell in=Int error-boundary=Oops = column(when($1 == 2, text(panic("two"))), text("cell " + $1.show))
tile Home = page(DropBtn, column(for i in items Cell(i)))
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`);
    expect(root.textContent).toContain("oops two");
    expect(live.fbMounts).toBe(1);

    await click("drop");
    expect(root.textContent).not.toContain("oops");
    expect(live.fbUnmounts).toBe(1);
  });

  it("treats one fallback shown by two boundaries as one tile on screen", async () => {
    // The same rule as any tile rendered in two places: mount when the first
    // appears, unmount when the last one leaves.
    const { live, click } = await start(`${COUNTS}
slot b1 : Bool = true
slot b2 : Bool = true
reducer f1 on=ui.click(Fix1) do= b1 := false
reducer f2 on=ui.click(Fix2) do= b2 := false
tile Fix1 = button(text="fix1", onClick=f1)
tile Fix2 = button(text="fix2", onClick=f2)
tile Oops in=PanicInfo = text("oops")
tile Boom1 error-boundary=Oops = column(when(b1, text(panic("one"))), text("one ok"))
tile Boom2 error-boundary=Oops = column(when(b2, text(panic("two"))), text("two ok"))
tile Home = page(Fix1, Fix2, Boom1, Boom2)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`);
    expect(live.fbMounts).toBe(1);

    await click("fix1");
    expect(live.fbUnmounts).toBe(0);

    await click("fix2");
    expect(live.fbUnmounts).toBe(1);
    expect(live.fbMounts).toBe(1);
  });

  it("fires mount for a fallback that hydration picks up from SSR", async () => {
    // The marker is a prop the DOM never shows, so the server's HTML is the
    // same with it; what it changes is the client's first render, which is
    // where the fallback is first seen on the client.
    const src = `${COUNTS}
tile Oops in=PanicInfo = column(text("oops " + $1.message))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile Home = page(text("home"), Boom)
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`;
    const rendered = await renderToString(await loadSource(src), { route: "/", routing });
    expect(rendered.html).toContain("oops bang");
    expect(rendered.html).not.toContain("Oops");

    const app = await loadSource(src);
    mountedRoot = document.createElement("div");
    mountedRoot.innerHTML = rendered.html;
    document.body.appendChild(mountedRoot);
    const { dispose } = hydrate(app, mountedRoot, rendered, { router: "memory" });
    disposeFn = dispose;
    await tick();
    expect(mountedRoot.textContent).toContain("oops bang");
    expect((app.live as Record<string, unknown>).fbMounts).toBe(1);
  });
});
