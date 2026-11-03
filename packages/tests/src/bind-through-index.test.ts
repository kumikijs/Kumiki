import { feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { fill, find, mountSource, withMounted } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const example = feature("238-bind-through-index");

/** Mount the example and run `body` against it, torn down whatever happens. */
async function withExample(body: (app: AppShape, root: HTMLElement) => void): Promise<void> {
  const app = await loadApp(example);
  await withMounted(app, async (root) => body(app, root));
}

type Row = { title: string; done: boolean; qty: number };
const rowsOf = (app: AppShape): Row[] => app.live?.rows as Row[];

describe("controls bound through a List index", () => {
  it("show the element the index names, and write that element alone", () =>
    withExample((app, root) => {
      expect(find<HTMLInputElement>(root, "#title").value).toBe("milk");
      expect(find<HTMLInputElement>(root, "#qty").value).toBe("1");
      fill(root, "#title", "oat milk");
      find<HTMLInputElement>(root, "#done input").click();
      fill(root, "#qty", "7");
      expect(rowsOf(app)).toEqual([
        { title: "oat milk", done: true, qty: 7 },
        { title: "eggs", done: false, qty: 6 },
      ]);
    }));

  it("follow the index when it moves, showing and writing the row it now names", () =>
    withExample((app, root) => {
      const title = find<HTMLInputElement>(root, "#title");
      find<HTMLButtonElement>(root, "#next").click();
      expect(app.live?.i).toBe(1);
      expect(find<HTMLInputElement>(root, "#title")).toBe(title);
      expect(title.value).toBe("eggs");
      expect(find<HTMLInputElement>(root, "#qty").value).toBe("6");
      fill(root, "#title", "brown eggs");
      expect(rowsOf(app)).toEqual([
        { title: "milk", done: false, qty: 1 },
        { title: "brown eggs", done: false, qty: 6 },
      ]);
    }));

  it("are marked with the path they write, the index as the key it names", () =>
    withExample((_app, root) => {
      expect(find(root, "#title").dataset.kumikiBind).toBe("rows[0].title");
      expect(find(root, "#note-a").dataset.kumikiBind).toBe('notes["a"]');
      find<HTMLButtonElement>(root, "#next").click();
      expect(find(root, "#title").dataset.kumikiBind).toBe("rows[1].title");
    }));

  it("keep focus across a write whose marker quotes the key", () =>
    withExample((app, root) => {
      const note = find<HTMLInputElement>(root, "#note-a");
      note.focus();
      fill(root, "#note-a", "firsts");
      expect(app.live?.notes).toEqual({ a: "firsts", b: "second" });
      expect(document.activeElement).toBe(note);
    }));
});

describe("every control that binds, through an index", () => {
  const SOURCE = withApp(
    `type Size = Small | Large
type Row = {title: Text, lit: Bool, qty: Int, size: Size}
slot rows : List(Row) = [{title: "a", lit: false, qty: 1, size: Small}, {title: "b", lit: false, qty: 2, size: Small}]
slot i : Int = 1
tile P = column(
  textarea(bind=rows[i].title, id="ta"),
  editable("x", bind=rows[i].title) {id: "ed"},
  switch(bind=rows[i].lit) {id: "sw"},
  radio(group="g", bind=rows[i].size, value=Large) {id: "rl"},
  select(bind=rows[i].size, options=[{label: "S", value: Small}, {label: "L", value: Large}]) {id: "sel"},
  slider(bind=rows[i].qty, min=0, max=9) {id: "sl"})`,
    "P",
  );
  const second = (app: AppShape) => (app.live?.rows as unknown[])[1];
  const first = { title: "a", lit: false, qty: 1, size: { _tag: "Small" } };

  it.each([
    ["textarea", (root: HTMLElement) => fill(root, "#ta", "typed"), { title: "typed" }],
    [
      "editable",
      (root: HTMLElement) => {
        const div = find(root, "#ed");
        div.textContent = "edited";
        div.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { title: "edited" },
    ],
    ["switch", (root: HTMLElement) => find(root, "#sw input").click(), { lit: true }],
    ["radio", (root: HTMLElement) => find(root, "#rl input").click(), { size: { _tag: "Large" } }],
    [
      "select",
      (root: HTMLElement) => {
        const sel = find<HTMLSelectElement>(root, "#sel");
        sel.value = "Large";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { size: { _tag: "Large" } },
    ],
    ["slider", (root: HTMLElement) => fill(root, "#sl", "5"), { qty: 5 }],
  ])("%s writes the element the index names", async (_kind, act, written) => {
    const { app, root } = await mountSource(SOURCE);
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
    const { root } = await mountSource(
      withApp(
        `type Row = {title: Text}
slot rows : List(Row) = [{title: "a"}, {title: "b"}]
slot i : Int = 5
tile Fallback in=PanicInfo = column(text("caught: " + $1.message))
tile P error-boundary=Fallback = column(input(bind=rows[i].title))`,
        "P",
      ),
    );
    expect(root.textContent).toContain("caught: Index 5 is out of range for a List of length 2");
  });
});

describe("a refinement on what an index names", () => {
  const ROW = `type Row = {qty: Int where between(1, 9)}`;
  const qtys = (app: AppShape): number[] => (app.live?.rows as { qty: number }[]).map((r) => r.qty);

  it("refuses a write through the index that the element fails, and shows why", async () => {
    const { app, root } = await mountSource(
      withApp(`${ROW}
slot rows : List(Row) = [{qty: 1}, {qty: 2}]
slot i    : Int       = 1
tile App = column(input(bind=rows[i].qty, type="number", id="q"), error(field=rows[1].qty))`),
    );
    fill(root, "#q", "50");
    expect(qtys(app)).toEqual([1, 2]);
    expect(root.textContent).toContain("Must be between 1 and 9");
    fill(root, "#q", "7");
    expect(qtys(app)).toEqual([1, 7]);
    expect(root.textContent).not.toContain("Must be between");
  });

  it("takes a valid write while another element already fails", async () => {
    const { app, root } = await mountSource(
      withApp(`${ROW}
slot rows : List(Row) = [{qty: 0}, {qty: 2}]
slot i    : Int       = 1
tile App = column(input(bind=rows[i].qty, type="number", id="q"))`),
    );
    fill(root, "#q", "7");
    expect(qtys(app)).toEqual([0, 7]);
  });

  it("holds a form's submit while the refused value shows", async () => {
    const { app, root } = await mountSource(
      withApp(`${ROW}
slot rows  : List(Row) = [{qty: 1}, {qty: 2}]
slot i     : Int       = 1
slot sends : Int       = 0
reducer send on=ui.submit(F) do= sends := sends + 1
tile F = form(column(input(bind=rows[i].qty, type="number", id="q"), button(text="Send", type="submit")))
tile App = column(F)`),
    );
    const submit = () =>
      find(root, "form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    fill(root, "#q", "50");
    submit();
    expect(app.live?.sends).toBe(0);
    fill(root, "#q", "7");
    submit();
    expect(app.live?.sends).toBe(1);
  });

  it.each([
    ["Text", "", `Map(Text, Row)`, `{"r": {qty: 1}}`, `"r"`, "r"],
    ["Int", "", `Map(Int, Row)`, `{4: {qty: 1}}`, `4`, "4"],
    ["Bool", "", `Map(Bool, Row)`, `{true: {qty: 1}}`, `true`, "true"],
    [
      "a record",
      "type Pt = {x: Int, y: Int}",
      `Map(Pt, Row)`,
      `{{x: 0, y: 1}: {qty: 1}}`,
      `{y: 1, x: 0}`,
      '{"x":0,"y":1}',
    ],
    ["a tuple", "", `Map(Tuple(Int, Int), Row)`, `{(0, 1): {qty: 1}}`, `(0, 1)`, "[0,1]"],
    [
      "a union",
      "type Shade = Plain | Tint(Int)",
      `Map(Shade, Row)`,
      `{Tint(1): {qty: 1}, Plain: {qty: 1}}`,
      `Plain`,
      '{"_tag":"Plain"}',
    ],
    [
      "an Option",
      "",
      `Map(Option(Int), Row)`,
      `{Some(1): {qty: 1}, None: {qty: 1}}`,
      `None`,
      '{"_tag":"None"}',
    ],
  ])("a Map keyed by %s refuses what the entry fails", async (_kind, decl, type, init, key, stored) => {
    const { app, root } = await mountSource(
      withApp(`${ROW}
${decl}
slot m : ${type} = ${init}
tile App = column(input(bind=m[${key}].qty, type="number", id="q"))`),
    );
    const before = app.live?.m;
    fill(root, "#q", "50");
    expect(app.live?.m).toEqual(before);
    fill(root, "#q", "7");
    expect(app.live?.m).toEqual({ ...(before as object), [stored]: { qty: 7 } });
  });

  it("forgets a refusal once its control follows the index to another element", async () => {
    const { root } = await mountSource(
      withApp(`${ROW}
slot rows : List(Row) = [{qty: 1}, {qty: 2}]
slot i    : Int       = 1
tile Back = button(text="back") {id: "back"}
reducer back on=ui.click(Back) do= i := 0
tile App = column(error(field=rows), input(bind=rows[i].qty, type="number", id="q"), Back)`),
    );
    fill(root, "#q", "50");
    expect(root.textContent).toContain("Must be between 1 and 9");
    find<HTMLButtonElement>(root, "#back").click();
    expect(find<HTMLInputElement>(root, "#q").value).toBe("1");
    expect(root.textContent).not.toContain("Must be between");
  });

  it("forgets a refusal whose index no longer names an element, rather than panic", async () => {
    const { app, root } = await mountSource(
      withApp(`${ROW}
slot rows : List(Row) = [{qty: 1}, {qty: 2}]
slot i    : Int       = 1
tile Drop = button(text="drop last") {id: "drop"}
reducer dropLast on=ui.click(Drop) do=
    rows := [rows[0]]
    i := 0
tile App = column(error(field=rows), input(bind=rows[i].qty, type="number", id="q"), Drop)`),
    );
    fill(root, "#q", "50");
    expect(root.textContent).toContain("Must be between 1 and 9");
    find<HTMLButtonElement>(root, "#drop").click();
    expect(qtys(app)).toEqual([1]);
    expect(find<HTMLInputElement>(root, "#q").value).toBe("1");
    expect(root.textContent).not.toContain("Must be between");
  });
});
