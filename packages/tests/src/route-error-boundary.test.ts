import { type AppShape, renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { mountApp, navigate, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

async function mountRoute(
  src: string,
  initialPath?: string,
): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadSource(src);
  const { root, handle } = mountApp(app, { router: "memory", ...(initialPath && { initialPath }) });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  await tick(0);
  return { app, root };
}

/** Mount at `/`, then move to `path` the way a link does. */
async function mountThenVisit(src: string, path: string) {
  const mounted = await mountRoute(src);
  await navigate(mounted.app, path);
  return mounted;
}

/** A tile whose render panics: `.get` on a `None` raises the controlled signal. */
const BOOM = `slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("caught: " + $1.message) {test-id: "fallback"})
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))`;

describe("a tile named as a route keeps its error boundary", () => {
  it("renders the fallback when the route root's own render panics", async () => {
    const { root } = await mountRoute(`${BOOM}
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("caught:");
    expect(root.querySelector('[data-kumiki-test="fallback"]')).not.toBeNull();
  });

  it("still renders the fallback when the same tile is a child", async () => {
    const { root } = await mountRoute(`${BOOM}
tile Host = column(Boom())
app M caps=[] routes={"/" -> Host, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("caught:");
  });

  it("carries the declaring tile's name into the fallback's PanicInfo", async () => {
    const { root } = await mountRoute(`slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("at " + $1.location))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("at Boom");
  });

  it.each([
    [
      "a sub-route parent whose own body panics, before its child renders",
      'tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(text(xs.head.get.show), route-outlet())',
    ],
    ["a sub-route child", 'tile Shell sub-routes={"/shell/a" -> Boom} = column(route-outlet())'],
    [
      "a parent whose whole body is the outlet",
      'tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = route-outlet()',
    ],
  ])("protects %s", async (_what, shell) => {
    const { root } = await mountThenVisit(
      `${BOOM}
tile NotFound = column(text("nf"))
${shell}
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(root.textContent).toContain("caught:");
  });

  it("leaves a route root with no boundary to the built-in panic display", async () => {
    const { root } = await mountRoute(`slot xs : List(Int) = []
tile Bare = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Bare, "/404" -> Bare} init=[]
`);
    expect(root.textContent).toContain("Something went wrong:");
    expect(root.querySelector('[data-kumiki-panic][role="alert"]')).not.toBeNull();
  });

  it("protects the tile a landing on /404 renders", async () => {
    const { root } = await mountThenVisit(
      `${BOOM}
tile Home = column(text("home"))
app M caps=[] routes={"/" -> Home, "/404" -> Boom} init=[]
`,
      "/no-such-path",
    );
    expect(root.textContent).toContain("caught:");
  });
});

describe("a boundary on a sub-routes parent covers the child in its outlet", () => {
  /** The child declares no boundary; the shell does. */
  const SHELL = `slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("caught: " + $1.message + " at " + $1.location) {test-id: "fallback"})
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Shell error-boundary=Fallback sub-routes={"/shell/a" -> Boom} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`;

  it("renders the parent's fallback, naming the child that panicked", async () => {
    const { root } = await mountThenVisit(SHELL, "/shell/a");
    expect(root.querySelector('[data-kumiki-test="fallback"]')).not.toBeNull();
    expect(root.textContent).toContain("caught: get called on None at Boom");
    expect(root.textContent).not.toContain("frame");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("still names the parent when the parent's own body panics", async () => {
    const { root } = await mountThenVisit(
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
    const { root } = await mountThenVisit(
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
    expect(root.textContent).toContain("frame");
  });

  it("keeps a healthy child in the outlet under a parent that declares a boundary", async () => {
    const { root } = await mountThenVisit(
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
    const { root } = await mountThenVisit(
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
    const { app, root } = await mountThenVisit(
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
    expect(app.live?.mounts).toBe(1);
    root.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick(0);
    expect(root.textContent).toContain("caught: x");
    expect(app.live?.unmounts).toBe(1);
    expect(app.live?.mounts).toBe(1);
  });

  it("names the route target, not a tile it renders inside its own body", async () => {
    const { root } = await mountThenVisit(
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

  it("fires route.error once, with the child's attribution, when no boundary catches it", async () => {
    const { app, root } = await mountThenVisit(
      `slot xs : List(Int) = []
slot fired : Int = 0
slot site : Text = "unset"
reducer sawErr
    on=route.error("/shell/*")
    do= fired := fired + 1
        site  := $event.location
tile NotFound = column(text("nf"))
tile Boom = column(text(xs.head.get.show))
tile Shell sub-routes={"/shell/a" -> Boom} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]
`,
      "/shell/a",
    );
    expect(app.live?.fired).toBe(1);
    expect(app.live?.site).toBe("Boom");
    expect(root.querySelector('[data-kumiki-panic="Boom"]')).not.toBeNull();
  });

  it("serves the parent's fallback from renderToString too", async () => {
    const app = await loadSource(SHELL);
    const rendered = await renderToString(app, { route: "/shell/a", routing });
    expect(rendered.html).toContain("caught: get called on None at Boom");
    expect(rendered.html).not.toContain("frame");
  });
});

describe("a panic is attributed to the route target being built", () => {
  it("names a route root that panics with no boundary", async () => {
    const { root } = await mountRoute(`slot xs : List(Int) = []
tile Bare = column(text(xs.head.get.show))
app M caps=[] routes={"/" -> Bare, "/404" -> Bare} init=[]
`);
    expect(root.querySelector('[data-kumiki-panic="Bare"][role="alert"]')).not.toBeNull();
  });

  it("names the /404 tile, which pickRootTile reaches by its own branch", async () => {
    const { root } = await mountRoute(
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
    const { root } = await mountRoute(`slot xs : List(Int) = []
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
  it("re-throws a key-invariant violation rather than showing the fallback", async () => {
    const { root } = await mountRoute(`slot items : List(Text) = ["a", "", "c"]
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Rows error-boundary=Fallback = column(for n in items text(n) {key: n})
tile Host = column(Rows())
app M caps=[] routes={"/" -> Rows, "/404" -> Host} init=[]
`);
    expect(root.textContent).not.toContain("caught:");
  });

  it("hands the fallback the same payload app.error gets", async () => {
    const { root } = await mountRoute(`slot xs : List(Int) = []
tile Fallback in=PanicInfo = column(text("m=" + $1.message + " at=" + $1.location + " cat=" + $1.category))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("m=get called on None at=Boom cat=tile-render");
  });

  it("keeps an empty panic message empty", async () => {
    const { root } = await mountRoute(`slot go : Bool = true
tile Fallback in=PanicInfo = column(text("len=" + $1.message.length.show))
tile Boom error-boundary=Fallback = column(when(go, text(panic(""))))
tile Host = column(Boom())
app M caps=[] routes={"/" -> Boom, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("len=0");
  });
});
