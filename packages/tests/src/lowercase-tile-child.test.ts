import { compile } from "@kumikijs/compiler";
import { renderToString, routing } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { mountSource, press } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

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
    const { app, root } = await mountSource(
      withApp(`slot leaf : Text = "hello"
slot show : Bool = true
slot seen : Int = 0
reducer sawLeaf on=tile.mount(leaf) do= seen := seen + 1
tile leaf = column(text("tile body"))
tile App = column(${child}, text("seen: " + seen.show))`),
    );
    expect(root.textContent).toContain("tile body");
    expect(root.textContent).toContain("seen: 1");
    expect(app.live?.seen).toBe(1);
  });

  it("fires tile.unmount when it leaves", async () => {
    const { app, root } = await mountSource(
      withApp(`slot leaf : Text = "hello"
slot show : Bool = true
slot log : List(Text) = []
reducer sawMount on=tile.mount(leaf) do= log := log.push("+leaf")
reducer sawUnmount on=tile.unmount(leaf) do= log := log.push("-leaf")
reducer hide on=ui.click(HideBtn) do= show := false
tile HideBtn = button(text="hide", onClick=hide)
tile leaf = text("tile body")
tile App = column(HideBtn, when(show, column(leaf)))`),
    );
    expect(root.textContent).toContain("tile body");
    expect(app.live?.log).toEqual(["+leaf"]);

    await press(root, "hide");
    expect(root.textContent).not.toContain("tile body");
    expect(app.live?.log).toEqual(["+leaf", "-leaf"]);
  });

  it.each([
    ["as a container's bare child", withApp(`${ALWAYS_PANICKING}\ntile App = column(leaf)`)],
    [
      "in a when arm",
      withApp(`${ALWAYS_PANICKING}\nslot show : Bool = true\ntile App = column(when(show, leaf))`),
    ],
    ["on a route target", withApp(ALWAYS_PANICKING, "leaf")],
  ])("catches a panic with its own error-boundary %s", async (_, src) => {
    const { root } = await mountSource(src);
    expect(root.textContent).toContain("caught: bang");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("mounts the fallback while the tile panics, and the tile once it renders", async () => {
    const { app, root } = await mountSource(
      withApp(`${PANICKING}
slot oopsShown : Int = 0
slot oopsGone : Int = 0
slot leafShown : Int = 0
reducer sawOops on=tile.mount(Oops) do= oopsShown := oopsShown + 1
reducer sawOopsGone on=tile.unmount(Oops) do= oopsGone := oopsGone + 1
reducer sawLeaf on=tile.mount(leaf) do= leafShown := leafShown + 1
tile App = column(LoadBtn, leaf)`),
    );
    const counts = () => [app.live?.oopsShown, app.live?.oopsGone, app.live?.leafShown];
    expect(root.textContent).toContain("caught: get called on None");
    expect(counts()).toEqual([1, 0, 0]);

    await press(root, "load");
    expect(root.textContent).toContain("data: 42");
    expect(root.textContent).not.toContain("caught:");
    expect(counts()).toEqual([1, 1, 1]);
  });

  it("serves the fallback from renderToString too", async () => {
    const app = await loadSource(
      withApp(`${PANICKING}
tile App = column(LoadBtn, leaf)`),
    );
    const rendered = await renderToString(app, { route: "/", routing });
    expect(rendered.html).toContain("caught: get called on None");
  });

  it("reads the slots in its body, not the bindings where it is written, as its capitalised twin does", async () => {
    // `leaf` is checked on its own, where `name` is the slot, so the loop's `name` must not reach it.
    const { root } = await mountSource(
      withApp(`slot leaf : Text = "hello"
slot name : Text = "the slot"
slot names : List(Text) = ["the loop"]
tile leaf = text("leaf: " + name)
tile Leaf = text("Leaf: " + name)
tile App = column(for name in names column(leaf, Leaf))`),
    );
    expect(root.textContent).toContain("leaf: the slot");
    expect(root.textContent).toContain("Leaf: the slot");
    expect(root.textContent).not.toContain("the loop");
  });
});

describe("a subscription on the tile around a bare child", () => {
  // The only element that fires click is `Oops`'s button, which renders in the child's place in
  // `Card`. A tile named like a builtin is the program's tile there, as the build renders it.
  const retry = (name: string): string =>
    withApp(`slot ${name} : Text = "hello"
slot n : Option(Int) = None
slot hits : Int = 0
reducer onRetry on=ui.click(Card) do= hits := hits + 1
tile Oops in=PanicInfo = button(text="retry")
tile ${name} error-boundary=Oops = text("w " + n.get.show)
tile Card = column(text("card"), ${name})
tile App = column(Card)`);
  const NAMES = [
    ["a lower-cased tile", "leaf"],
    ["a tile named like a builtin", "spinner"],
  ];

  it.each(NAMES)("is not reported as reaching nothing, for %s", (_, name) => {
    const result = compile(retry(name), { runtimeSpecifier: "./runtime.js" });
    expect(result.warnings.map((w) => w.code)).not.toContain("W0212");
  });

  it.each(NAMES)("fires on a click on the button %s's fallback renders", async (_, name) => {
    const { app, root } = await mountSource(retry(name));
    await press(root, "retry");
    expect(app.live?.hits).toBe(1);
  });
});
