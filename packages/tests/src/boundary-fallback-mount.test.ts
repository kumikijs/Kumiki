import { hydrate, renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { click, freshRoot, mountApp, navigate, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

async function start(src: string, initialPath = "/") {
  const app = await loadSource(src);
  const { root, handle } = mountApp(app, { router: "memory", initialPath });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  await tick(0);
  const press = async (label: string): Promise<void> => {
    click(root, label);
    await tick(0);
  };
  return { app, root, press };
}

/** Counts both events for `Oops`, the fallback every program here declares. */
const COUNTS = `slot fbMounts : Int = 0
slot fbUnmounts : Int = 0
reducer sawFbMount on=tile.mount(Oops) do= fbMounts := fbMounts + 1
reducer sawFbUnmount on=tile.unmount(Oops) do= fbUnmounts := fbUnmounts + 1`;

describe("an error-boundary fallback fires tile.mount and tile.unmount", () => {
  it("fires mount for a fallback at a call site, beside a sibling tile's", async () => {
    const { app, root } = await start(`slot fallbackMounts : Int = 0
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
    expect(app.live?.fallbackMounts).toBe(1);
    expect(app.live?.okMounts).toBe(1);
  });

  it("fires mount once while the fallback re-renders, and unmount when the tile recovers", async () => {
    const { app, root, press } = await start(`${COUNTS}
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
    expect(app.live?.fbMounts).toBe(1);

    await press("bump");
    await press("bump");
    expect(root.textContent).toContain("oops bang n=2");
    expect(app.live?.fbMounts).toBe(1);
    expect(app.live?.fbUnmounts).toBe(0);

    await press("fix");
    expect(root.textContent).toContain("boom ok");
    expect(app.live?.fbUnmounts).toBe(1);
    expect(app.live?.boomMounts).toBe(1);

    await press("break");
    expect(root.textContent).toContain("oops bang");
    expect(app.live?.fbMounts).toBe(2);
    expect(app.live?.boomUnmounts).toBe(1);
  });

  it.each([
    {
      where: "a route target",
      src: `tile Oops in=PanicInfo = text("oops")
tile Boom error-boundary=Oops = column(text(panic("bang")))
tile Other = text("other")
app M caps=[] routes={"/" -> Boom, "/other" -> Other, "/404" -> Other} init=[]`,
      from: "/",
      shown: "oops",
      to: "/other",
      after: "other",
    },
    {
      where: "a sub-routes parent over a panicking child",
      src: `tile Oops in=PanicInfo = text("oops at " + $1.location)
tile Child = column(text(panic("bang")))
tile Healthy = text("healthy child")
tile NotFound = text("nf")
tile Shell error-boundary=Oops sub-routes={"/shell/a" -> Child, "/shell/b" -> Healthy} = column(text("frame"), route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> NotFound} init=[]`,
      from: "/shell/a",
      shown: "oops at Child",
      to: "/shell/b",
      after: "healthy child",
    },
  ])("fires mount and unmount for a fallback on $where", async ({
    src,
    from,
    shown,
    to,
    after,
  }) => {
    const { app, root } = await start(`${COUNTS}\n${src}\n`, from);
    expect(root.textContent).toContain(shown);
    expect(app.live?.fbMounts).toBe(1);

    await navigate(app, to);
    expect(root.textContent).toContain(after);
    expect(app.live?.fbUnmounts).toBe(1);
  });

  it("fires unmount when the row showing the fallback leaves a for", async () => {
    const { app, root, press } = await start(`${COUNTS}
slot items : List(Int) = [1, 2, 3]
reducer drop on=ui.click(DropBtn) do= items := [1, 3]
tile DropBtn = button(text="drop", onClick=drop)
tile Oops in=PanicInfo = text("oops " + $1.message)
tile Cell in=Int error-boundary=Oops = column(when($1 == 2, text(panic("two"))), text("cell " + $1.show))
tile Home = page(DropBtn, column(for i in items Cell(i)))
app M caps=[] routes={"/" -> Home, "/404" -> Home} init=[]
`);
    expect(root.textContent).toContain("oops two");
    expect(app.live?.fbMounts).toBe(1);

    await press("drop");
    expect(root.textContent).not.toContain("oops");
    expect(app.live?.fbUnmounts).toBe(1);
  });

  it("treats one fallback shown by two boundaries as one tile on screen", async () => {
    const { app, press } = await start(`${COUNTS}
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
    expect(app.live?.fbMounts).toBe(1);

    await press("fix1");
    expect(app.live?.fbUnmounts).toBe(0);

    await press("fix2");
    expect(app.live?.fbUnmounts).toBe(1);
    expect(app.live?.fbMounts).toBe(1);
  });

  it("fires mount for a fallback that hydration picks up from SSR", async () => {
    // The marker is never rendered, so the server's HTML is unchanged; the client's first render is
    // where the fallback is first seen.
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
    const root = freshRoot();
    root.innerHTML = rendered.html;
    const handle = hydrate(app, root, rendered, { router: "memory" });
    onTestFinished(() => {
      handle.dispose();
      root.remove();
    });
    await tick(0);
    expect(root.textContent).toContain("oops bang");
    expect(app.live?.fbMounts).toBe(1);
  });
});
