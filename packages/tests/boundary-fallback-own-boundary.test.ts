// An `error-boundary` fallback's own `error-boundary` holds where it renders as
// a fallback.
//
// lifecycle.md §7.3 scopes a boundary to the tile that declares it, wherever
// that tile renders, and a fallback renders in place of the tile that
// panicked. So a panic in the fallback is caught by the fallback's own
// boundary, and so on along the chain, at a call site, on a route target and
// in the server's HTML alike; a fallback with no boundary of its own leaves its
// panic to the boundaries around. A chain that comes back to a tile already on
// it would be an infinite tree, and is E0005 at check time.
//
// Runtime-truth for the chain: `check` and `build` are green either way.

import { compile } from "@kumikijs/compiler";
import { mount, renderToString, routing } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `Boom` panics, its fallback `Oops` panics, and `Oops`'s fallback `Last` renders. */
const CHAIN = `slot xs : List(Int) = []
tile Last in=PanicInfo = text("last resort: " + $1.message + " at " + $1.location)
tile Oops in=PanicInfo error-boundary=Last = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))`;

describe("a fallback's own error-boundary catches a panic in the fallback", () => {
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
    mountedRoot = document.createElement("div");
    document.body.appendChild(mountedRoot);
    const { dispose } = mount(app, mountedRoot, { router: "memory" });
    disposeFn = dispose;
    await tick();
    return { root: mountedRoot, live: app.live as Record<string, unknown> };
  };

  it("renders the fallback's fallback at a call site", async () => {
    const { root } = await start(`${CHAIN}
tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("last resort: get called on None at Oops");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("renders the fallback's fallback on a route target", async () => {
    const { root } = await start(`${CHAIN}
tile Other = text("other")
app M caps=[] routes={"/" -> Boom, "/404" -> Other} init=[]
`);
    expect(root.textContent).toContain("last resort: get called on None at Oops");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("follows a chain three fallbacks deep, naming the fallback that panicked", async () => {
    const { root } = await start(`slot xs : List(Int) = []
slot names : Map(Text, Int) = {}
tile Last in=PanicInfo = text("last resort: " + $1.message + " at " + $1.location)
tile Mid in=PanicInfo error-boundary=Last = column(text(names["k"].show))
tile Oops in=PanicInfo error-boundary=Mid = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile App = column(text("frame"), Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain('last resort: Key "k" is not in the Map at Mid');
    expect(root.textContent).toContain("frame");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("prefers the fallback's own boundary to one around the tile that panicked", async () => {
    const { root } = await start(`${CHAIN}
tile Outer in=PanicInfo = text("outer: " + $1.message)
tile Shell error-boundary=Outer = column(text("frame"), Boom)
tile App = column(Shell)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("frame");
    expect(root.textContent).toContain("last resort: get called on None at Oops");
    expect(root.textContent).not.toContain("outer:");
  });

  it("leaves a panic in a fallback with no boundary of its own to the boundaries around", async () => {
    const { root } = await start(`slot xs : List(Int) = []
tile Outer in=PanicInfo = text("outer: " + $1.message + " at " + $1.location)
tile Oops in=PanicInfo = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile Shell error-boundary=Outer = column(text("frame"), Boom)
tile App = column(Shell)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("outer: get called on None at Shell");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("mounts the fallback that rendered, not the one that panicked", async () => {
    // The same rule as at a call site: the boundary discards the tree that
    // panicked, marker and all, so `tile.mount(Oops)` does not fire.
    const { root, live } = await start(`${CHAIN}
slot oopsMounts : Int = 0
slot lastMounts : Int = 0
reducer sawOops on=tile.mount(Oops) do= oopsMounts := oopsMounts + 1
reducer sawLast on=tile.mount(Last) do= lastMounts := lastMounts + 1
tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("last resort:");
    expect(live.lastMounts).toBe(1);
    expect(live.oopsMounts).toBe(0);
  });

  it("serves the fallback's fallback from renderToString too", async () => {
    const app = await loadSource(`${CHAIN}
tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    const rendered = await renderToString(app, { route: "/", routing });
    expect(rendered.html).toContain("last resort: get called on None at Oops");
  });
});

describe("a chain of fallbacks that returns to itself is E0005", () => {
  const refusal = (src: string) => {
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    return r.kind === "ok"
      ? []
      : r.errors.map((e) => ({
          code: e.code,
          message: e.message,
          at: `${e.pos.line}:${e.pos.col}`,
        }));
  };

  it("refuses a fallback that is its own boundary, at that clause", () => {
    expect(
      refusal(`slot xs : List(Int) = []
tile Oops in=PanicInfo error-boundary=Oops = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`),
    ).toEqual([
      { code: "E0005", message: 'Tile "Oops" expands into itself (Oops → Oops)', at: "2:39" },
    ]);
  });

  it("refuses two fallbacks that name each other, at the first clause of the loop", () => {
    expect(
      refusal(`slot xs : List(Int) = []
tile A in=PanicInfo error-boundary=B = column(text(xs.head.get.show))
tile B in=PanicInfo error-boundary=A = column(text(xs.head.get.show))
tile Boom error-boundary=A = column(text(panic("bang")))
tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`),
    ).toEqual([{ code: "E0005", message: 'Tile "A" expands into itself (A → B → A)', at: "2:36" }]);
  });
});
