// A tile written as a container's child by its bare name renders as a call of
// it does, whatever the name's case.
//
// language.md §1.7.1 reads the name of a defined tile, written as a positional
// argument of a builtin that renders tiles there, as that tile. A capitalised
// name parses as a call (`column(Leaf)`) and a lower-cased one as a name
// (`column(leaf)`), which the checker also reads as a value — so each program
// here declares a slot `leaf` beside the tile `leaf`. Either way the child is
// the call of the tile with nothing passed, and lowers as one: it carries the
// marker `tile.mount` / `tile.unmount` are diffed against (lifecycle.md
// §7.1.6), its own `error-boundary` holds (§7.3), and its body reads the
// slots, not the bindings of the place it is written in (§1.7.2).
//
// Runtime-truth throughout: `check` and `build` are green either way.

import { compile } from "@kumikijs/compiler";
import { mount, renderToString, routing } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

const APP = `app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

/** `leaf` panics while `data` is `None`, and its boundary shows `Oops`; "load" fills `data`. */
const PANICKING = `slot leaf : Text = "hello"
slot data : Option(Int) = None
reducer doLoad on=ui.click(LoadBtn) do= data := Some(42)
tile LoadBtn = button(text="load", onClick=doLoad)
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text("data: " + data.get.show))`;

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
  const root = mountedRoot;
  const click = async (label: string): Promise<void> => {
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!button) throw new Error(`no button "${label}" in: ${root.textContent}`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  };
  return { root, live: app.live as Record<string, unknown>, click };
};

describe("a tile written as a container's bare child", () => {
  it("fires tile.mount", async () => {
    const { root, live } = await start(`slot leaf : Text = "hello"
slot seen : Int = 0
reducer sawLeaf on=tile.mount(leaf) do= seen := seen + 1
tile leaf = column(text("tile body"))
tile App = column(leaf, text("seen: " + seen.show))
${APP}
`);
    expect(root.textContent).toContain("tile body");
    expect(root.textContent).toContain("seen: 1");
    expect(live.seen).toBe(1);
  });

  it("fires tile.unmount when it leaves", async () => {
    const { root, live, click } = await start(`slot leaf : Text = "hello"
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
    expect(live.log).toEqual(["+leaf"]);

    await click("hide");
    expect(root.textContent).not.toContain("tile body");
    expect(live.log).toEqual(["+leaf", "-leaf"]);
  });

  it("catches a panic with the tile's own error-boundary", async () => {
    const { root } = await start(`slot leaf : Text = "hello"
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text(panic("bang")))
tile App = column(leaf)
${APP}
`);
    expect(root.textContent).toContain("caught: bang");
    expect(root.querySelector("[data-kumiki-panic]")).toBeNull();
  });

  it("mounts the fallback while the tile panics, and the tile once it renders", async () => {
    const { root, live, click } = await start(`${PANICKING}
slot oopsShown : Int = 0
slot oopsGone : Int = 0
slot leafShown : Int = 0
reducer sawOops on=tile.mount(Oops) do= oopsShown := oopsShown + 1
reducer sawOopsGone on=tile.unmount(Oops) do= oopsGone := oopsGone + 1
reducer sawLeaf on=tile.mount(leaf) do= leafShown := leafShown + 1
tile App = column(LoadBtn, leaf)
${APP}
`);
    expect(root.textContent).toContain("caught: get called on None");
    expect([live.oopsShown, live.oopsGone, live.leafShown]).toEqual([1, 0, 0]);

    await click("load");
    expect(root.textContent).toContain("data: 42");
    expect(root.textContent).not.toContain("caught:");
    expect([live.oopsShown, live.oopsGone, live.leafShown]).toEqual([1, 1, 1]);
  });

  it("serves the fallback from renderToString too", async () => {
    const app = await loadSource(`${PANICKING}
tile App = column(LoadBtn, leaf)
${APP}
`);
    const rendered = await renderToString(app, { route: "/", routing });
    expect(rendered.html).toContain("caught: get called on None");
  });

  it.each(["row", "card", "list", "form"])("is the same child of %s", async (container) => {
    const { root, live } = await start(`slot leaf : Text = "hello"
slot seen : Int = 0
reducer sawLeaf on=tile.mount(leaf) do= seen := seen + 1
tile leaf = text("tile body")
tile App = column(${container}(leaf), text("seen: " + seen.show))
${APP}
`);
    expect(root.textContent).toContain("tile body");
    expect(live.seen).toBe(1);
  });

  it("reads the slots in its body, not the bindings where it is written", async () => {
    // `leaf` is checked on its own, where `name` is the slot; the `for` that
    // binds another `name` around the child is not in its scope.
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

  it("emits what the call of a capitalised tile emits, the name aside", () => {
    const lowered = (name: string): string => {
      const r = compile(
        `slot leaf : Text = "hello"
slot seen : Int = 0
reducer sawLeaf on=tile.mount(${name}) do= seen := seen + 1
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile ${name} error-boundary=Oops = column(text("body " + leaf))
tile App = column(${name}, text("seen: " + seen.show))
${APP}
`,
        { runtimeSpecifier: "./runtime.js" },
      );
      if (r.kind !== "ok") throw new Error(r.errors.map((e) => e.message).join("\n"));
      return r.js;
    };
    expect(lowered("leaf")).toBe(lowered("Leaf").replaceAll(/\bLeaf\b/g, "leaf"));
  });
});

describe("a lower-cased tile where the parser reads the name as a call", () => {
  // In an arm of `when` / `if` / `for` / `match` and in a tile's body any name
  // parses as a tile call, and a route target names a tile outright, so these
  // positions lower a lower-cased tile as a call; they pin what the bare child
  // above is held to.
  it("fires tile.mount in a when arm", async () => {
    const { live } = await start(`slot show : Bool = true
slot seen : Int = 0
reducer sawLeaf on=tile.mount(leaf) do= seen := seen + 1
tile leaf = text("tile body")
tile App = column(when(show, leaf), text("seen: " + seen.show))
${APP}
`);
    expect(live.seen).toBe(1);
  });

  it("holds the boundary in a when arm", async () => {
    const { root } = await start(`slot show : Bool = true
tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text(panic("bang")))
tile App = column(when(show, leaf))
${APP}
`);
    expect(root.textContent).toContain("caught: bang");
  });

  it("holds the boundary on a route target", async () => {
    const { root } = await start(`tile Oops in=PanicInfo = text("caught: " + $1.message)
tile leaf error-boundary=Oops = column(text(panic("bang")))
app M caps=[] routes={"/" -> leaf, "/404" -> leaf} init=[]
`);
    expect(root.textContent).toContain("caught: bang");
  });
});
