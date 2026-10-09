// A `bind=` target steps through an index as the left of `:=` does (forms.md
// §5.1, language.md §1.6.3): `input(bind=rows[i].title)` shows what the read
// `rows[i].title` reads and writes what `rows[i].title := v` writes, through
// the runtime's one setter. The index is read again on every render, so a
// control bound through `rows[i]` follows `i`. The scenario beside
// `238-bind-through-index` drives the writes through its steps; what is here
// is what a scenario cannot see — the value each control shows as the index
// moves, every kind of control bound through one, the bind marker, focus
// across a write, and the panic an index that names no element raises.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "238-bind-through-index.kumiki");

afterEach(() => {
  document.body.replaceChildren();
});

function el<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} not found`);
  return found;
}

function fill(root: ParentNode, selector: string, value: string): void {
  const inp = el<HTMLInputElement>(root, selector);
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountInto(app: AppShape): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return root;
}

type Row = { title: string; done: boolean; qty: number };
const rowsOf = (app: AppShape): Row[] => app.live?.rows as Row[];

describe("controls bound through a List index", () => {
  it("show the element the index names, and write that element alone", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    expect(el<HTMLInputElement>(root, "#title").value).toBe("milk");
    expect(el<HTMLInputElement>(root, "#qty").value).toBe("1");
    fill(root, "#title", "oat milk");
    el<HTMLInputElement>(root, "#done input").click();
    fill(root, "#qty", "7");
    expect(rowsOf(app)).toEqual([
      { title: "oat milk", done: true, qty: 7 },
      { title: "eggs", done: false, qty: 6 },
    ]);
  });

  it("follow the index when it moves, showing and writing the row it now names", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    const title = el<HTMLInputElement>(root, "#title");
    el<HTMLButtonElement>(root, "#next").click();
    expect(app.live?.i).toBe(1);
    // The same element, now showing the second row.
    expect(el<HTMLInputElement>(root, "#title")).toBe(title);
    expect(title.value).toBe("eggs");
    expect(el<HTMLInputElement>(root, "#qty").value).toBe("6");
    fill(root, "#title", "brown eggs");
    expect(rowsOf(app)).toEqual([
      { title: "milk", done: false, qty: 1 },
      { title: "brown eggs", done: false, qty: 6 },
    ]);
  });

  it("are marked with the path they write, the index as the key it names", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    expect(el(root, "#title").dataset.kumikiBind).toBe("rows[0].title");
    expect(el(root, "#note-a").dataset.kumikiBind).toBe('notes["a"]');
    el<HTMLButtonElement>(root, "#next").click();
    expect(el(root, "#title").dataset.kumikiBind).toBe("rows[1].title");
  });

  it("keep focus across a write whose marker quotes the key", async () => {
    // The focus restore after a render looks the control up by its marker,
    // which here holds a quoted key.
    const app = await loadApp(example);
    const root = mountInto(app);
    const note = el<HTMLInputElement>(root, "#note-a");
    note.focus();
    fill(root, "#note-a", "firsts");
    expect(app.live?.notes).toEqual({ a: "firsts", b: "second" });
    expect(document.activeElement).toBe(note);
  });
});

describe("every control that binds, through an index", () => {
  const SOURCE = `type Size = Small | Large
type Row = {title: Text, lit: Bool, qty: Int, size: Size}
slot rows : List(Row) = [{title: "a", lit: false, qty: 1, size: Small}, {title: "b", lit: false, qty: 2, size: Small}]
slot i : Int = 1
tile P = column(
  textarea(bind=rows[i].title, id="ta"),
  editable("x", bind=rows[i].title) {id: "ed"},
  switch(bind=rows[i].lit) {id: "sw"},
  radio(group="g", bind=rows[i].size, value=Large) {id: "rl"},
  select(bind=rows[i].size, options=[{label: "S", value: Small}, {label: "L", value: Large}]) {id: "sel"},
  slider(bind=rows[i].qty, min=0, max=9) {id: "sl"})
app A caps=[] routes={"/" -> P, "/404" -> P} init=[]
`;
  const second = (app: AppShape) => (app.live?.rows as unknown[])[1];
  const first = { title: "a", lit: false, qty: 1, size: { _tag: "Small" } };

  it.each([
    ["textarea", (root: HTMLElement) => fill(root, "#ta", "typed"), { title: "typed" }],
    [
      "editable",
      (root: HTMLElement) => {
        const div = el(root, "#ed");
        div.textContent = "edited";
        div.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { title: "edited" },
    ],
    ["switch", (root: HTMLElement) => el(root, "#sw input").click(), { lit: true }],
    ["radio", (root: HTMLElement) => el(root, "#rl input").click(), { size: { _tag: "Large" } }],
    [
      "select",
      (root: HTMLElement) => {
        const sel = el<HTMLSelectElement>(root, "#sel");
        sel.value = "Large";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { size: { _tag: "Large" } },
    ],
    ["slider", (root: HTMLElement) => fill(root, "#sl", "5"), { qty: 5 }],
  ])("%s writes the element the index names", async (_kind, act, written) => {
    const app = await loadSource(SOURCE);
    const root = mountInto(app);
    act(root);
    expect(second(app)).toEqual({
      title: "b",
      lit: false,
      qty: 2,
      size: { _tag: "Small" },
      ...written,
    });
    expect((app.live?.rows as unknown[])[0]).toEqual(first);
  });
});

describe("an index that names no element", () => {
  it("panics the render, as the read of the same path does", async () => {
    const app = await loadSource(`type Row = {title: Text}
slot rows : List(Row) = [{title: "a"}, {title: "b"}]
slot i : Int = 5
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile P error-boundary=Fallback = column(input(bind=rows[i].title))
app A caps=[] routes={"/" -> P, "/404" -> P} init=[]
`);
    const root = mountInto(app);
    expect(root.textContent).toContain("caught: Index 5 is out of range for a List of length 2");
  });
});
