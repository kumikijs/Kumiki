import { compile } from "@kumikijs/compiler";
import { renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { click, mountSource, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

/** `Boom` panics, its fallback `Oops` panics, and `Oops`'s fallback `Last` renders. */
const CHAIN = `slot xs : List(Int) = []
tile Last in=PanicInfo = text("last resort: " + $1.message + " at " + $1.location)
tile Oops in=PanicInfo error-boundary=Last = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))`;

describe("a fallback's own error-boundary catches a panic in the fallback", () => {
  it.each([
    { where: "a call site", path: "/", src: withApp(`${CHAIN}\ntile App = column(Boom)`) },
    { where: "a route target", path: "/", src: withApp(CHAIN, "Boom") },
    {
      // The shell is lowered with the outlet fill between its marker and its boundary.
      where: "a sub-routes shell",
      path: "/s/child",
      src: `${CHAIN}
tile Child = column(text(panic("bang")))
tile Shell error-boundary=Oops sub-routes={"/s/child" -> Child} = column(text("frame"), route-outlet())
tile Other = text("other")
app M caps=[] routes={"/s/*" -> Shell, "/404" -> Other} init=[]`,
    },
  ])("renders the fallback's fallback at $where", async ({ path, src }) => {
    const { root } = await mountSource(`${src}\n`, path);
    expect(root.textContent).toContain("last resort: get called on None at Oops");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("follows a chain three fallbacks deep, naming the fallback that panicked", async () => {
    const { root } = await mountSource(
      withApp(`slot xs : List(Int) = []
slot names : Map(Text, Int) = {}
tile Last in=PanicInfo = text("last resort: " + $1.message + " at " + $1.location)
tile Mid in=PanicInfo error-boundary=Last = column(text(names["k"].show))
tile Oops in=PanicInfo error-boundary=Mid = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile App = column(text("frame"), Boom)`),
    );
    expect(root.textContent).toContain('last resort: Key "k" is not in the Map at Mid');
    expect(root.textContent).toContain("frame");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("prefers the fallback's own boundary to one around the tile that panicked", async () => {
    const { root } = await mountSource(
      withApp(`${CHAIN}
tile Outer in=PanicInfo = text("outer: " + $1.message)
tile Shell error-boundary=Outer = column(text("frame"), Boom)
tile App = column(Shell)`),
    );
    expect(root.textContent).toContain("frame");
    expect(root.textContent).toContain("last resort: get called on None at Oops");
    expect(root.textContent).not.toContain("outer:");
  });

  it("leaves a panic in a fallback with no boundary of its own to the boundaries around", async () => {
    const { root } = await mountSource(
      withApp(`slot xs : List(Int) = []
tile Outer in=PanicInfo = text("outer: " + $1.message + " at " + $1.location)
tile Oops in=PanicInfo = column(text(xs.head.get.show))
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile Shell error-boundary=Outer = column(text("frame"), Boom)
tile App = column(Shell)`),
    );
    expect(root.textContent).toContain("outer: get called on None at Shell");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("mounts the fallback that rendered, not the one that panicked", async () => {
    const { app, root } = await mountSource(
      withApp(`${CHAIN}
slot oopsMounts : Int = 0
slot lastMounts : Int = 0
reducer sawOops on=tile.mount(Oops) do= oopsMounts := oopsMounts + 1
reducer sawLast on=tile.mount(Last) do= lastMounts := lastMounts + 1
tile App = column(Boom)`),
    );
    expect(root.textContent).toContain("last resort:");
    expect(app.live?.lastMounts).toBe(1);
    expect(app.live?.oopsMounts).toBe(0);
  });

  it("serves the fallback's fallback from renderToString too", async () => {
    const app = await loadSource(withApp(`${CHAIN}\ntile App = column(Boom)`));
    const rendered = await renderToString(app, { route: "/", routing });
    expect(rendered.html).toContain("last resort: get called on None at Oops");
  });
});

describe("a subscription on a tile reaches the fallbacks along a chain under it", () => {
  // The only element that fires click is `Last`'s button, two fallbacks down from `Widget`.
  const RETRY = withApp(`slot n : Option(Int) = None
slot hits : Int = 0
reducer onRetry on=ui.click(Card) do= hits := hits + 1
tile Last in=PanicInfo = button(text="retry")
tile FbA in=PanicInfo error-boundary=Last = text("fb " + n.get.show)
tile Widget error-boundary=FbA = text("w " + n.get.show)
tile Card = column(text("card"), Widget)
tile App = column(Card)`);

  it("is not reported as reaching nothing", () => {
    const result = compile(RETRY, { runtimeSpecifier: "./runtime.js" });
    expect(result.warnings.map((w) => w.code)).not.toContain("W0212");
  });

  it("fires on a click on the button the fallback's fallback renders", async () => {
    const { app, root } = await mountSource(RETRY);
    click(root, "retry");
    await tick(0);
    expect(app.live?.hits).toBe(1);
  });
});
