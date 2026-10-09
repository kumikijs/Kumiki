import { mount, renderToString, routing } from "@kumikijs/runtime";
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
    // The parent's own body panics, so the boundary it declares is the one that has to run — the child never gets to render.
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
    const { root } = await run(`slot xs : List(Int) = []
tile Bare = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Bare, "/404" -> Bare} init=[]
`);
    expect(root.textContent).toContain("Something went wrong:");
    expect(root.querySelector('[data-kumiki-panic][role="alert"]')).not.toBeNull();
  });

  it("protects the tile a landing on /404 renders", async () => {
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

describe("a boundary on a sub-routes parent covers the child in its outlet", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const at = async (src: string, path: string) => {
    const app = await loadSource(src);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot, { router: "memory" });
    disposeFn = dispose;
    await tick();
    (app as typeof app & { _navigate: (p: string, replace?: boolean) => void })._navigate(
      path,
      false,
    );
    await tick();
    return { app, root: mountedRoot };
  };

  /** The issue's program: the child declares no boundary, the shell does. */
  const SHELL = `slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("caught: " + $1.message + " at " + $1.location) {test-id: "fallback"})
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`;

  it("renders the parent's fallback when the outlet child panics", async () => {
    const { root } = await at(SHELL, "/shell/a");
    expect(root.querySelector('[data-kumiki-test="fallback"]')).not.toBeNull();
    expect(root.textContent).toContain("caught: get called on None");
    expect(root.textContent).not.toContain("frame");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("names the tile that panicked in PanicInfo.location, not the parent", async () => {
    const { root } = await at(SHELL, "/shell/a");
    expect(root.textContent).toContain("at Boom");
  });

  it("still names the parent when the parent's own body panics", async () => {
    const { root } = await at(
      `slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("caught at " + $1.location))
tile NotFound = column(text("nf"))
tile Child = column(text("child"))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Child} = column(text(xs.head.get.show), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("caught at Shell");
  });

  it("lets a boundary on the child win over the parent's — nearest, not outermost", async () => {
    const { root } = await at(
      `slot xs : List(Int) = []
tile Outer in=PanicInfo = column(text("outer caught " + $1.message) {test-id: "outer"})
tile Inner in=PanicInfo = column(text("inner caught " + $1.message + " at " + $1.location) {test-id: "inner"})
tile NotFound = column(text("nf"))
tile Boom error-boundary=Inner = column(text(xs.head.get.show))
tile Shell error-boundary=Outer sub-routes={"/shell/a" -> Boom} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.querySelector('[data-kumiki-test="inner"]')).not.toBeNull();
    expect(root.querySelector('[data-kumiki-test="outer"]')).toBeNull();
    expect(root.textContent).toContain("inner caught get called on None at Boom");
    // The child's boundary contained the panic, so the shell rendered as usual.
    expect(root.textContent).toContain("frame");
  });

  it("keeps a healthy child in the outlet under a parent that declares a boundary", async () => {
    // The parent's factory changed shape to make room for the child; the ordinary case has to come out the same as before.
    const { root } = await at(
      `tile Fallback in=PanicInfo = column(text("caught"))
tile NotFound = column(text("nf"))
tile Child = column(text("child"))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Child} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("frame");
    expect(root.textContent).toContain("child");
    expect(root.textContent).not.toContain("caught");
  });

  it("leaves a child with no boundary anywhere to the built-in display, naming the child", async () => {
    const { root } = await at(
      `slot xs : List(Int) = []
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Shell sub-routes={"/shell/a" -> Boom} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("Something went wrong:");
    expect(root.querySelector('[data-kumiki-panic="Boom"][role="alert"]')).not.toBeNull();
  });

  it("fires tile.unmount for the child when the outlet child starts panicking", async () => {
    const { app, root } = await at(
      `slot go : Bool = false
slot mounts : Int = 0
slot unmounts : Int = 0
reducer sawMount on=tile.mount(Child) do= mounts := mounts + 1
reducer sawUnmount on=tile.unmount(Child) do= unmounts := unmounts + 1
reducer fire on=ui.click(Btn) do= go := true
tile Btn = button(text="go", onClick=fire)
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile NotFound = column(text("nf"))
tile Child = column(text("child"), when(go, text(panic("x"))))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Child} = column(Btn, route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    const live = app.live as Record<string, unknown>;
    expect(live.mounts).toBe(1);
    root.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(root.textContent).toContain("caught: x");
    expect(live.unmounts).toBe(1);
    expect(live.mounts).toBe(1);
  });

  it("names the route target, not a tile it renders inside its own body", async () => {
    const { root } = await at(
      `slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("caught at " + $1.location))
tile NotFound = column(text("nf"))
tile Inner = column(text(xs.head.get.show))
tile Boom = column(Inner)
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("caught at Boom");
    expect(root.textContent).not.toContain("Inner");
  });

  it("fires route.error once when the page it leaves in place stays broken", async () => {
    const { app, root } = await at(
      `slot xs : List(Int) = []
slot fired : Int = 0
reducer sawErr on=route.error("/shell/*") do= fired := fired + 1
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Shell sub-routes={"/shell/a" -> Boom} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect((app.live as Record<string, unknown>).fired).toBe(1);
    expect(root.querySelector('[data-kumiki-panic="Boom"]')).not.toBeNull();
  });

  it("hands route.error the same attribution when no boundary catches it", async () => {
    const { app } = await at(
      `slot xs : List(Int) = []
slot site : Text = "unset"
reducer sawErr on=route.error("/shell/*") do= site := $event.location
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Shell sub-routes={"/shell/a" -> Boom} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect((app.live as Record<string, unknown>).site).toBe("Boom");
  });

  it("serves the parent's fallback from renderToString too", async () => {
    const app = await loadSource(SHELL);
    const rendered = await renderToString(app, { route: "/shell/a", routing });
    expect(rendered.html).toContain("caught: get called on None at Boom");
    expect(rendered.html).not.toContain("frame");
  });
});

describe("a panic is attributed to the route target being built", () => {
  let disposeFn: (() => void) | undefined;
  let mountedRoot: HTMLElement | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    mountedRoot?.remove();
    mountedRoot = undefined;
  });

  const at = async (src: string, path = "/") => {
    const app = await loadSource(src);
    mountedRoot = freshRoot();
    const { dispose } = mount(app, mountedRoot, { router: "memory", initialPath: path });
    disposeFn = dispose;
    await tick();
    return mountedRoot;
  };

  it("names a route root that panics with no boundary", async () => {
    const root = await at(`slot xs : List(Int) = []
tile Bare = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Bare, "/404" -> Bare} init=[]
`);
    expect(root.querySelector('[data-kumiki-panic="Bare"][role="alert"]')).not.toBeNull();
  });

  it("names the /404 tile, which pickRootTile reaches by its own branch", async () => {
    const root = await at(
      `slot xs : List(Int) = []
tile Home = column(text("home"))
tile Missing = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Home, "/404" -> Missing} init=[]
`,
      "/no-such-path",
    );
    expect(root.querySelector('[data-kumiki-panic="Missing"][role="alert"]')).not.toBeNull();
  });

  it("names the declaring tile when its own fallback panics", async () => {
    const root = await at(`slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text(xs.head.get.show))
tile Boom error-boundary=Fallback = column(text(panic("first")))
tile Host = column(text("host"))
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("Something went wrong: get called on None");
    expect(root.querySelector('[data-kumiki-panic="Boom"][role="alert"]')).not.toBeNull();
  });
});

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
    const root = await mountIt(`slot items : List(Text) = ["a", "", "c"]
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Rows error-boundary=Fallback = column(for n in items text(n) {key: n})
tile Host = column(Rows())
app M caps=[] routes={"/" -> Rows, "/404" -> Host} init=[]
`);
    expect(root.textContent).not.toContain("caught:");
  });

  it("hands the fallback the same payload app.error gets", async () => {
    const root = await mountIt(`slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("m=" + $1.message + " at=" + $1.location + " cat=" + $1.category))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("m=get called on None at=Boom cat=tile-render");
  });

  it("keeps an empty panic message empty", async () => {
    const root = await mountIt(`slot go : Bool = true
tile Fallback in=PanicInfo = column(text("len=" + $1.message.length.show))
tile Boom error-boundary=Fallback = column(when(go, text(panic(""))))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("len=0");
  });

  it("gives the fallback tile no mount marker of its own", async () => {
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
    expect(live.mounts).toBe(11);
  });
});
