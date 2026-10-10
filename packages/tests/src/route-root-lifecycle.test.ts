import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { mountApp, navigate, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

async function mountRoute(src: string): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadSource(src);
  const { root, handle } = mountApp(app, { router: "memory" });
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  await tick(0);
  return { app, root };
}

const MOUNTS = `slot mounts : Int = 0
slot unmounts : Int = 0
reducer sawMount on=tile.mount(Panel) do= mounts := mounts + 1
reducer sawUnmount on=tile.unmount(Panel) do= unmounts := unmounts + 1
tile Panel = column(text("panel"))
tile Other = column(text("other"))`;

describe("a tile named as a route fires tile.mount and tile.unmount", () => {
  it("fires mount for the tile the app lands on", async () => {
    const { app } = await mountRoute(`${MOUNTS}
app M caps=[] routes={"/" -> Panel, "/404" -> Other} init=[]
`);
    expect(app.live?.mounts).toBe(1);
    expect(app.live?.unmounts).toBe(0);
  });

  it("fires unmount for the old root and mount for the new one across a navigation", async () => {
    const { app } = await mountRoute(`${MOUNTS}
app M caps=[] routes={"/" -> Panel, "/other" -> Other, "/404" -> Other} init=[]
`);
    expect(app.live?.mounts).toBe(1);
    await navigate(app, "/other");
    expect(app.live?.unmounts).toBe(1);
    await navigate(app, "/");
    expect(app.live?.mounts).toBe(2);
  });

  it.each([
    ["as the route root", '"/" -> Boom'],
    ["as a child", '"/" -> Host'],
  ])("fires no mount for a tile that is showing its fallback, %s", async (_where, home) => {
    const { app, root } = await mountRoute(`slot xs : List(Int) = []
slot mounts : Int = 0
reducer sawMount on=tile.mount(Boom) do= mounts := mounts + 1
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile Boom error-boundary=Fallback = column(text(xs.head.get.show))
tile Host = column(Boom())
app M caps=[] routes={${home}, "/404" -> Host} init=[]
`);
    expect(root.textContent).toContain("caught:");
    expect(app.live?.mounts).toBe(0);
  });

  it("fires unmount when a mounted route root starts panicking", async () => {
    const { app, root } = await mountRoute(`slot go : Bool = false
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
    expect(app.live?.mounts).toBe(1);
    expect(app.live?.unmounts).toBe(0);

    root.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick(0);
    expect(root.textContent).toContain("caught:");
    expect(app.live?.mounts).toBe(1);
    expect(app.live?.unmounts).toBe(1);
  });

  it("fires for a sub-route child, and for the parent that holds the outlet", async () => {
    const { app } = await mountRoute(`${MOUNTS}
reducer sawShell on=tile.mount(Shell) do= mounts := mounts + 10
tile Shell sub-routes={"/shell/a" -> Panel} = column(route-outlet())
app M caps=[] routes={"/shell/*" -> Shell, "/404" -> Other} init=[]
`);
    await navigate(app, "/shell/a");
    expect(app.live?.mounts).toBe(11);
  });
});
