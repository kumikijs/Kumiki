import { renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { click, mountApp, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

async function start(src: string) {
  const app = await loadSource(src);
  const { root, handle } = mountApp(app, { router: "memory" });
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

const APP = `app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

/** `leaf` panics while `data` is `None`, and its boundary shows `Oops`; "load" fills `data`. */
const PANICKING = `slot leaf : Text = "hello"
slot data : Option(Int) = None
reducer doLoad on=ui.click(LoadBtn) do= data := Some(42)
tile LoadBtn = button(text="load", onClick=doLoad)
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text("data: " + data.get.show))`;

/** `leaf` panics on every render, and its boundary shows `Oops`. */
const ALWAYS_PANICKING = `slot leaf : Text = "hello"
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text(panic("bang")))`;

describe("a lower-cased tile, which shares its name with a slot", () => {
  it.each([
    ["as a column's bare child", "column(leaf)"],
    ["as a row's bare child", "row(leaf)"],
    ["as a card's bare child", "card(leaf)"],
    ["as a list's bare child", "list(leaf)"],
    ["as a form's bare child", "form(leaf)"],
    ["in a when arm", "when(show, leaf)"],
  ])("fires tile.mount %s", async (_, child) => {
    const { app, root } = await start(`slot leaf : Text = "hello"
slot show : Bool = true
slot seen : Int = 0
reducer sawLeaf on=tile.mount(leaf) do= seen := seen + 1
tile leaf = column(text("tile body"))
tile App = column(${child}, text("seen: " + seen.show))
${APP}
`);
    expect(root.textContent).toContain("tile body");
    expect(root.textContent).toContain("seen: 1");
    expect(app.live?.seen).toBe(1);
  });

  it("fires tile.unmount when it leaves", async () => {
    const { app, root, press } = await start(`slot leaf : Text = "hello"
slot show : Bool = true
slot log : List(Text) = []
reducer sawMount on=tile.mount(leaf) do= log := log.push("+leaf")
reducer sawUnmount on=tile.unmount(leaf) do= log := log.push("-leaf")
reducer hide on=ui.click(HideBtn) do= show := false
tile HideBtn = button(text="hide", onClick=hide)
tile leaf = text("tile body")
tile App = column(HideBtn, when(show, column(leaf)))
${APP}
`);
    expect(root.textContent).toContain("tile body");
    expect(app.live?.log).toEqual(["+leaf"]);

    await press("hide");
    expect(root.textContent).not.toContain("tile body");
    expect(app.live?.log).toEqual(["+leaf", "-leaf"]);
  });

  it.each([
    ["as a container's bare child", `tile App = column(leaf)\n${APP}`],
    ["in a when arm", `slot show : Bool = true\ntile App = column(when(show, leaf))\n${APP}`],
    ["on a route target", `app M caps=[] routes={"/" -> leaf, "/404" -> leaf} init=[]`],
  ])("catches a panic with its own error-boundary %s", async (_, rest) => {
    const { root } = await start(`${ALWAYS_PANICKING}\n${rest}\n`);
    expect(root.textContent).toContain("caught: bang");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("mounts the fallback while the tile panics, and the tile once it renders", async () => {
    const { app, root, press } = await start(`${PANICKING}
slot oopsShown : Int = 0
slot oopsGone : Int = 0
slot leafShown : Int = 0
reducer sawOops on=tile.mount(Oops) do= oopsShown := oopsShown + 1
reducer sawOopsGone on=tile.unmount(Oops) do= oopsGone := oopsGone + 1
reducer sawLeaf on=tile.mount(leaf) do= leafShown := leafShown + 1
tile App = column(LoadBtn, leaf)
${APP}
`);
    const counts = () => [app.live?.oopsShown, app.live?.oopsGone, app.live?.leafShown];
    expect(root.textContent).toContain("caught: get called on None");
    expect(counts()).toEqual([1, 0, 0]);

    await press("load");
    expect(root.textContent).toContain("data: 42");
    expect(root.textContent).not.toContain("caught:");
    expect(counts()).toEqual([1, 1, 1]);
  });

  it("serves the fallback from renderToString too", async () => {
    const app = await loadSource(`${PANICKING}
tile App = column(LoadBtn, leaf)
${APP}
`);
    const rendered = await renderToString(app, { route: "/", routing });
    expect(rendered.html).toContain("caught: get called on None");
  });

  it("reads the slots in its body, not the bindings where it is written", async () => {
    // `leaf` is checked on its own, where `name` is the slot, so the loop's `name` must not reach it.
    const { root } = await start(`slot leaf : Text = "hello"
slot name : Text = "the slot"
slot names : List(Text) = ["the loop"]
tile leaf = text("name: " + name)
tile App = column(for name in names column(leaf))
${APP}
`);
    expect(root.textContent).toContain("name: the slot");
    expect(root.textContent).not.toContain("the loop");
  });
});
