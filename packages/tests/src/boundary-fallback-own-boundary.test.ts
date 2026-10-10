import { renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { mountApp, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

async function start(src: string) {
  const app = await loadSource(src);
  const { root, handle } = mountApp(app, { router: "memory" });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  await tick(0);
  return { app, root };
}

/** `Boom` panics, its fallback `Oops` panics, and `Oops`'s fallback `Last` renders. */
const CHAIN = `slot xs : List(Int) = []
tile Last in=PanicInfo = text("last resort: " + $1.message + " at " + $1.location)
tile Oops in=PanicInfo error-boundary=Last = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))`;

describe("a fallback's own error-boundary catches a panic in the fallback", () => {
  it.each([
    {
      where: "a call site",
      tail: `tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`,
    },
    {
      where: "a route target",
      tail: `tile Other = text("other")
app M caps=[] routes={"/" -> Boom, "/404" -> Other} init=[]`,
    },
  ])("renders the fallback's fallback at $where", async ({ tail }) => {
    const { root } = await start(`${CHAIN}\n${tail}\n`);
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
    const { app, root } = await start(`${CHAIN}
slot oopsMounts : Int = 0
slot lastMounts : Int = 0
reducer sawOops on=tile.mount(Oops) do= oopsMounts := oopsMounts + 1
reducer sawLast on=tile.mount(Last) do= lastMounts := lastMounts + 1
tile App = column(Boom)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]
`);
    expect(root.textContent).toContain("last resort:");
    expect(app.live?.lastMounts).toBe(1);
    expect(app.live?.oopsMounts).toBe(0);
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
