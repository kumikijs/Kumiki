import { describe, expect, it } from "vitest";
import { click, find, mountApp, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

/** Mount `defs` with `Probe` at every path; `flip` clicks the button reading "flip". */
async function mountProbe(defs: string): Promise<{ root: HTMLElement; flip: () => Promise<void> }> {
  const { root } = mountApp(await loadSource(withApp(defs, "Probe")));
  return {
    root,
    flip: async () => {
      click(root, "flip");
      await tick(0);
    },
  };
}

const tiles = (root: HTMLElement, kind: string): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`[data-kumiki-tile="${kind}"]`));

describe("a prop that goes away takes its mark with it", () => {
  const REMOVAL = `
slot draft : Text = ""
slot set   : Bool = true

reducer drop on=ui.click(Flip) do= set := !set

tile Flip  = button(text="flip")
tile Probe = column(
               Flip,
               button(text="go") {variant: if set then "ghost" else ""},
               image(src="/a.png", alt="A cat") {width: if set then 120 else ""},
               divider() {orientation: if set then "vertical" else "horizontal"},
               link(to="/next", text="next") {external: set},
               grid(text("g")) {cols: 2, rows: if set then 3 else ""},
               text("t") {class: if set then "lit" else "", test-id: if set then "t" else "",
                          role: if set then "note" else "", max-w: if set then 400 else ""},
               input(bind=draft) {disabled: set, auto-complete: if set then "off" else ""})
`;

  it("removes what the previous render wrote, on the elements it wrote it to", async () => {
    const { root, flip } = await mountProbe(REMOVAL);
    const go = tiles(root, "button")[1];
    const img = find(root, '[data-kumiki-tile="image"]');
    const hr = find(root, '[data-kumiki-tile="divider"]');
    const a = find(root, '[data-kumiki-tile="link"]');
    const grid = find(root, '[data-kumiki-tile="grid"]');
    // The grid holds a text tile of its own, so take the marked one: the last.
    const text = tiles(root, "text").at(-1);
    const input = find<HTMLInputElement>(root, '[data-kumiki-tile="input"]');

    expect(go?.getAttribute("data-kumiki-variant")).toBe("ghost");
    expect(img.getAttribute("width")).toBe("120");
    expect(hr.getAttribute("aria-orientation")).toBe("vertical");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(grid.style.getPropertyValue("grid-template-rows")).toBe("repeat(3, 1fr)");
    expect(text?.getAttribute("class")).toBe("lit");
    expect(text?.getAttribute("data-kumiki-test")).toBe("t");
    expect(text?.getAttribute("role")).toBe("note");
    expect(text?.style.getPropertyValue("max-width")).toBe("400px");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("autocomplete")).toBe("off");

    await flip();

    expect(tiles(root, "button")[1]).toBe(go);
    expect(tiles(root, "text").at(-1)).toBe(text);
    expect(go?.getAttribute("data-kumiki-variant")).toBe(null);
    expect(img.getAttribute("width")).toBe(null);
    expect(hr.getAttribute("aria-orientation")).toBe(null);
    expect(a.getAttribute("target")).toBe(null);
    expect(a.getAttribute("rel")).toBe(null);
    expect(grid.style.getPropertyValue("grid-template-rows")).toBe("");
    expect(text?.getAttribute("class")).toBe("");
    expect(text?.getAttribute("data-kumiki-test")).toBe(null);
    expect(text?.getAttribute("role")).toBe(null);
    expect(text?.style.getPropertyValue("max-width")).toBe("");
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("autocomplete")).toBe(null);
  });
});

describe("common props survive a re-render", () => {
  // These props are applied outside the per-kind renderers, so a reused element keeps whatever the first render put on it unless the reconcile diffs them.
  const BOUND = `
slot lit  : Bool = false
slot name : Text = ""

reducer flip on=ui.click(Flip) do= lit := !lit

tile Flip  = button(text="flip")
tile Probe = column(
               Flip,
               text("x") {class: if lit then "lit" else "dim",
                          test-id: if lit then "after" else "before",
                          aria: if lit then {label: "on"} else {}},
               button(text=if lit then "saving" else "save") {loading: lit},
               image(src="/a.png", alt="A cat", width=if lit then 200 else 100),
               input(bind=name, disabled=lit))
`;

  it("swaps the class rather than accumulating both", async () => {
    const { root, flip } = await mountProbe(BOUND);
    const text = find(root, '[data-kumiki-tile="text"]');
    expect(text.getAttribute("class")).toBe("dim");
    await flip();
    expect(find(root, '[data-kumiki-tile="text"]')).toBe(text);
    expect(text.getAttribute("class")).toBe("lit");
  });

  it("rewrites a test-id and drops an aria key that went away", async () => {
    const { root, flip } = await mountProbe(BOUND);
    const text = find(root, '[data-kumiki-tile="text"]');
    expect(text.getAttribute("data-kumiki-test")).toBe("before");
    expect(text.getAttribute("aria-label")).toBe(null);
    await flip();
    expect(text.getAttribute("data-kumiki-test")).toBe("after");
    expect(text.getAttribute("aria-label")).toBe("on");
    await flip();
    expect(text.getAttribute("aria-label")).toBe(null);
  });

  it("disables a control in place", async () => {
    const { root, flip } = await mountProbe(BOUND);
    const input = find<HTMLInputElement>(root, '[data-kumiki-tile="input"]');
    expect(input.disabled).toBe(false);
    await flip();
    expect(find(root, '[data-kumiki-tile="input"]')).toBe(input);
    expect(input.disabled).toBe(true);
  });

  it("resizes an image in place", async () => {
    const { root, flip } = await mountProbe(BOUND);
    const img = find(root, '[data-kumiki-tile="image"]');
    expect(img.getAttribute("width")).toBe("100");
    await flip();
    expect(find(root, '[data-kumiki-tile="image"]')).toBe(img);
    expect(img.getAttribute("width")).toBe("200");
  });

  it("turns a button's spinner on and back off", async () => {
    const { root, flip } = await mountProbe(BOUND);
    const save = tiles(root, "button")[1] as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.querySelector('[data-kumiki-tile="spinner"]')).toBe(null);
    await flip();
    expect(save.disabled).toBe(true);
    expect(save.querySelector('[data-kumiki-tile="spinner"]')).not.toBe(null);
    // The label is still the button's accessible name with a spinner in front.
    expect(save.textContent).toContain("saving");
    await flip();
    expect(save.disabled).toBe(false);
    expect(save.querySelector('[data-kumiki-tile="spinner"]')).toBe(null);
  });

  it("keeps the same spinner element while the label changes", async () => {
    // Re-creating it would restart its animation mid-flight, on exactly the button the user is waiting for.
    const { root, flip } = await mountProbe(`
slot n : Int = 0

reducer bump on=ui.click(Flip) do= n := n + 1

tile Flip  = button(text="flip")
tile Probe = column(Flip, button(text="uploading " + n.show) {loading: true})
`);
    const busy = tiles(root, "button")[1] as HTMLButtonElement;
    const spinner = busy.querySelector('[data-kumiki-tile="spinner"]');
    expect(spinner).not.toBe(null);
    await flip();
    expect(busy.textContent).toContain("uploading 1");
    expect(busy.querySelector('[data-kumiki-tile="spinner"]')).toBe(spinner);
  });
});
