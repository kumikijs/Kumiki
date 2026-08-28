// A tile named as a route is still that tile.
//
// The chrome a user tile gets — the `_named(…)` marker the runtime diffs
// `tile.mount` / `tile.unmount` against (lifecycle.md §7.1.6), and the
// `try` / `catch` its `error-boundary` lowers to (§7.3) — is applied by
// `tileCallJs`, the lowering for a *call site*. A route target used to be
// lowered straight from the route table by `genTile`, which is the body and
// nothing else, so a tile had both guarantees everywhere except at a route
// root; it goes through `genRouteTile` now. That inverted the boundary in
// particular: the tile was protected as a child and unprotected in the one
// position lifecycle.md §7.3 names.
//
// The last describe is the other half of the same subject: what a boundary
// takes. Giving a route root one closes the tier-2 detection path for anything
// it swallows, so what it refuses to swallow has to be pinned beside it.
//
// These run the real pipeline and the real runtime, because every guarantee
// here is runtime-truth: `check` and `build` were green throughout.

import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freshRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

/** A tile whose render panics: `.get` on a `None` raises the controlled signal. */
const BOOM = `slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("caught: " + $1.message) {test-id: "fallback"})
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))`;

const MOUNTS = `slot mounts : Int = 0
slot unmounts : Int = 0
reducer sawMount on=tile.mount(Panel) do= mounts := mounts + 1
reducer sawUnmount on=tile.unmount(Panel) do= unmounts := unmounts + 1
tile Panel = column(text("panel"))
tile Other = column(text("other"))`;

describe("a tile named as a route keeps its error boundary", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const run = async (src: string, path = "/") => {
    const app = await loadSource(src);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot, { router: "memory" });
    disposeFn = dispose;
    await tick();
    if (path !== "/") {
      (app as typeof app & { _navigate: (p: string, replace?: boolean) => void })._navigate(
        path,
        false,
      );
      await tick();
    }
    return { app, root: mountedRoot };
  };

  it("renders the fallback when the route root's own render panics", async () => {
    const { root } = await run(`${BOOM}
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("caught:");
    expect(root.querySelector('[data-kumiki-test="fallback"]')).not.toBeNull();
  });

  it("still renders the fallback when the same tile is a child", async () => {
    const { root } = await run(`${BOOM}
tile Host = column(Boom())
app M caps=[] routes={"/" -> Host, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("caught:");
  });

  it("carries the declaring tile's name into the fallback's PanicInfo", async () => {
    const { root } = await run(`slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("at " + $1.location))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("at Boom");
  });

  it("protects a sub-route parent", async () => {
    // The parent's own body panics, so the boundary it declares is the one that
    // has to run — the child never gets to render.
    const { root } = await run(
      `${BOOM}
tile NotFound = column(text("nf"))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(text(xs.head.get.show), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("caught:");
  });

  it("protects a sub-route child", async () => {
    const { root } = await run(
      `${BOOM}
tile NotFound = column(text("nf"))
tile Shell sub-routes={"/shell/a" -> Boom} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("caught:");
  });

  it("leaves a route root with no boundary to the built-in panic display", async () => {
    // The declared-boundary case must not be confused with the un-declared one:
    // lifecycle.md §7.3 keeps a top-level display for a root that names none,
    // and this rule does not take it away. Asserted against the markup that
    // display actually emits — "something non-empty rendered" would also pass
    // on the 404 tile, or on a stale tree.
    const { root } = await run(`slot xs : List(Int) = []
tile Bare = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Bare, "/404" -> Bare} init=[]
`);
    expect(root.textContent).toContain("Something went wrong:");
    expect(root.querySelector('[data-kumiki-panic][role="alert"]')).not.toBeNull();
  });

  it("protects the tile a landing on /404 renders", async () => {
    // `/404` is not matched like the others (`pickRootTile` reaches it by its
    // own branch), and it is the one route every program has.
    const { root } = await run(
      `${BOOM}
tile Home = column(text("home"))
app M caps=[] routes={"/" -> Home, "/404" -> Boom} init=[]
`,
      "/no-such-path",
    );
    expect(root.textContent).toContain("caught:");
  });

  it("protects a parent whose whole body is the outlet", async () => {
    // The marker has to survive here: `injectRouteOutlet` replaces the parent's
    // tree when the body *is* the outlet, which works only because `_named`
    // shallow-copies and keeps `kind`. A wrapper node would break it silently.
    const { root } = await run(
      `${BOOM}
tile NotFound = column(text("nf"))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = route-outlet()
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("caught:");
  });
});

/**
 * What a boundary takes, and what it refuses.
 *
 * §7.2.2 defines a panic as a controlled signal — `panic(message)`, the
 * polymorphic `.get`. Anything else that reaches the `catch` is a defect in the
 * generated code or in the runtime, and a boundary that swallowed one would
 * turn a failure into a rendered page: `smoke` and `scenario` both verify
 * through the error channel, so nothing would be left to see. Before this,
 * declaring a boundary was enough to hide `_d_1 is not defined` from tier 2.
 */
describe("an error boundary catches a panic and re-throws a defect", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const mountIt = async (src: string) => {
    const app = await loadSource(src);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot, { router: "memory" });
    disposeFn = dispose;
    await tick();
    return mountedRoot;
  };

  it("re-throws a key-invariant violation rather than showing the fallback", async () => {
    // `_wk` throws a plain Error deliberately, and its own comment says it does
    // so "the outer render bailout catches the panic and falls back to a full
    // rebuild" — which a boundary that caught it would prevent.
    const root = await mountIt(`slot items : List(Text) = ["a", "", "c"]
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Rows error-boundary=Fallback = column(for n in items text(n) {key: n})
tile Host = column(Rows())
app M caps=[] routes={"/" -> Rows, "/404" -> Host} init=[]
`);
    expect(root.textContent).not.toContain("caught:");
  });

  it("hands the fallback the same payload app.error gets", async () => {
    // `{message, location, category}` — the shape `handleLivePanic` builds, so
    // the two ways a panic reaches a program agree. `category` used to be
    // absent, and a fallback reading it rendered the string "undefined".
    const root = await mountIt(`slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("m=" + $1.message + " at=" + $1.location + " cat=" + $1.category))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("m=get called on None at=Boom cat=render");
  });

  it("keeps an empty panic message empty", async () => {
    // `String(err && err.message || err)` fell through to the error object,
    // so `panic("")` reached the fallback as the class name.
    const root = await mountIt(`slot go : Bool = true
tile Fallback in=PanicInfo = column(text("len=" + $1.message.length.show))
tile Boom error-boundary=Fallback = column(when(go, text(panic(""))))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("len=0");
  });

  it("gives the fallback tile no mount marker of its own", async () => {
    // The fallback is lowered by the boundary rather than through a call site,
    // so `tile.mount(<the fallback>)` never fires. Pinned because it is a
    // consequence of where the lowering happens, not a decision.
    const app = await loadSource(`slot xs : List(Int) = []
slot fbMounts : Int = 0
reducer sawFb on=tile.mount(Fallback) do= fbMounts := fbMounts + 1
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot, { router: "memory" });
    disposeFn = dispose;
    await tick();
    expect(mountedRoot.textContent).toContain("caught:");
    expect((app.live as Record<string, unknown>).fbMounts).toBe(0);
  });
});

describe("a tile named as a route fires tile.mount and tile.unmount", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const start = async (src: string) => {
    const app = await loadSource(src);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot, { router: "memory" });
    disposeFn = dispose;
    await tick();
    return app;
  };

  it("fires mount for the tile the app lands on", async () => {
    const app = await start(`${MOUNTS}
app M caps=[] routes={"/" -> Panel, "/404" -> Other} init=[]
`);
    expect((app.live as Record<string, unknown>).mounts).toBe(1);
    expect((app.live as Record<string, unknown>).unmounts).toBe(0);
  });

  it("fires unmount for the old root and mount for the new one across a navigation", async () => {
    const app = await start(`${MOUNTS}
app M caps=[] routes={"/" -> Panel, "/other" -> Other, "/404" -> Other} init=[]
`);
    const live = app.live as Record<string, unknown>;
    expect(live.mounts).toBe(1);

    (app as typeof app & { _navigate: (p: string, replace?: boolean) => void })._navigate(
      "/other",
      false,
    );
    await tick();
    expect(live.unmounts).toBe(1);

    (app as typeof app & { _navigate: (p: string, replace?: boolean) => void })._navigate(
      "/",
      false,
    );
    await tick();
    expect(live.mounts).toBe(2);
  });

  it("fires no mount for a tile that is showing its fallback, in either position", async () => {
    // The boundary wraps the marker from the outside, so a tile that panicked
    // did not render and has nothing to diff against. That is a consequence of
    // the wrap order rather than a decision, which is why it is pinned in both
    // positions: whatever it is, a route root and a call site agree.
    const src = `slot xs : List(Int) = []
slot mounts : Int = 0
reducer sawMount on=tile.mount(Boom) do= mounts := mounts + 1
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
`;
    const asRoot = await start(
      `${src}app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]\n`,
    );
    expect(mountedRoot?.textContent).toContain("caught:");
    expect((asRoot.live as Record<string, unknown>).mounts).toBe(0);

    disposeFn?.();
    mountedRoot?.remove();

    const asChild = await start(
      `${src}app M caps=[] routes={"/" -> Host, "/404" -> Host} init=[]\n`,
    );
    expect(mountedRoot?.textContent).toContain("caught:");
    expect((asChild.live as Record<string, unknown>).mounts).toBe(0);
  });

  it("fires unmount when a mounted route root starts panicking", async () => {
    // The other end of the fallback case above, and behaviour this fix creates:
    // before it a route root fired neither event, so nothing pinned the
    // transition. It goes through `syncMountedTiles`' set difference, and a
    // regression there leaves the runtime believing the tile is still mounted,
    // so a user's teardown never runs.
    const app = await start(`slot go : Bool = false
slot mounts : Int = 0
slot unmounts : Int = 0
reducer sawMount on=tile.mount(Boom) do= mounts := mounts + 1
reducer sawUnmount on=tile.unmount(Boom) do= unmounts := unmounts + 1
reducer fire on=ui.click(Btn) do= go := true
tile Btn = button(text="go", onClick=fire)
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Boom error-boundary=Fallback = column(Btn, when(go, text(panic("x"))))
tile Host = column(text("host"))
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    const live = app.live as Record<string, unknown>;
    expect(live.mounts).toBe(1);
    expect(live.unmounts).toBe(0);

    const btn = mountedRoot?.querySelector("button");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(mountedRoot?.textContent).toContain("caught:");
    expect(live.mounts).toBe(1);
    expect(live.unmounts).toBe(1);
  });

  it("fires for a sub-route child, and for the parent that holds the outlet", async () => {
    const app = await start(`${MOUNTS}
reducer sawShell on=tile.mount(Shell) do= mounts := mounts + 10
tile Shell sub-routes={"/shell/a" -> Panel} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> Other} init=[]
`);
    const live = app.live as Record<string, unknown>;
    (app as typeof app & { _navigate: (p: string, replace?: boolean) => void })._navigate(
      "/shell/a",
      false,
    );
    await tick();
    // 10 for the parent, 1 for the child: both are route targets, and the
    // count tells them apart without a second slot.
    expect(live.mounts).toBe(11);
  });
});
