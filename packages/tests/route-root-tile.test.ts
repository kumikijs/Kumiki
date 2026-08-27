// A tile named as a route is still that tile.
//
// The chrome a user tile gets — the `_named(…)` marker the runtime diffs
// `tile.mount` / `tile.unmount` against (lifecycle.md §7.1.6), and the
// `try` / `catch` its `error-boundary` lowers to (§7.3) — is applied by
// `tileCallJs`, the lowering for a *call site*. A route target is lowered
// straight from the route table by `genTile`, which is the body and nothing
// else, so a tile got both guarantees everywhere except at a route root.
//
// That inverted the boundary in particular: the tile was protected as a child
// and unprotected in the one position lifecycle.md §7.3 names.
//
// These run the real pipeline and the real runtime, because both guarantees are
// runtime-truth: `check` and `build` were green throughout.

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
    // and this rule does not take it away.
    const { root } = await run(`slot xs : List(Int) = []
tile Bare = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Bare, "/404" -> Bare} init=[]
`);
    expect(root.textContent).not.toContain("caught:");
    expect(root.textContent ?? "").not.toBe("");
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
