import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountApp, typeInto } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";

const program = (lists: string, body: string) => `
${lists}
slot n     : Int  = 0
slot draft : Text = ""
reducer tick on=ui.click(Tick) do= n := n + 1
tile Tick = button(text="tick")
tile App = column(Tick, input(bind=draft), text("n=" + n.show), ${body})
app A
  caps   = []
  routes = {"/" -> App, "/404" -> App}
  init   = []`;

let disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
  vi.restoreAllMocks();
});

async function mounted(src: string): Promise<{ root: HTMLElement; app: AppShape }> {
  const app = await loadSource(src);
  const { root, handle } = mountApp(app);
  disposers.push(() => {
    handle.dispose();
    root.remove();
  });
  return { root, app };
}

/** Every `console.error` line the runtime writes from here on. */
function errors(): string[] {
  const seen: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(" "));
  });
  return seen;
}

const SCORES = `slot scores : List(Int) = [7, 3, 7]`;
const LOOP = `column(for s in scores text("score " + s.show))`;

describe("a for over a list that repeats a value", () => {
  it("re-renders without a reconcile panic", async () => {
    const { root } = await mounted(program(SCORES, LOOP));
    const seen = errors();
    click(root, "tick");
    expect(seen).toEqual([]);
    expect(root.textContent).toContain("n=1");
    expect(root.textContent?.match(/score 7/g)?.length).toBe(2);
  });

  it("keeps the input beside the list across keystrokes", async () => {
    const { root, app } = await mounted(program(SCORES, LOOP));
    const seen = errors();
    const input = root.querySelector("input") as HTMLInputElement;
    typeInto(input, "a");
    typeInto(input, "ab");
    expect(app.live?.draft).toBe("ab");
    expect(root.querySelector("input")).toBe(input);
    expect(input.isConnected).toBe(true);
    expect(seen).toEqual([]);
  });

  it("keeps each list item's element across an unrelated re-render", async () => {
    const { root } = await mounted(program(SCORES, LOOP));
    const before = Array.from(root.querySelectorAll("*")).filter((e) =>
      e.textContent?.startsWith("score "),
    );
    click(root, "tick");
    for (const el of before) expect(el.isConnected).toBe(true);
  });
});

describe("two for loops under one parent that share a value", () => {
  it("re-render without a reconcile panic", async () => {
    const lists = `slot evens : List(Int) = [2, 4]\nslot primes : List(Int) = [2, 3]`;
    const body = `column(for e in evens text("even " + e.show), for p in primes text("prime " + p.show))`;
    const { root } = await mounted(program(lists, body));
    const seen = errors();
    click(root, "tick");
    expect(seen).toEqual([]);
    expect(root.textContent).toContain("even 2");
    expect(root.textContent).toContain("prime 2");
  });
});

describe("a keyed reorder", () => {
  it.each([
    // keys |1|1, |1|2, |1|3 -> |1|3, |1|2, |1|1
    ["distinct values", "[1, 2, 3]", [2, 1, 0]],
    // keys |1|7, |2|7, |1|3 -> |1|3, |1|7, |2|7
    ["a repeated value", "[7, 7, 3]", [2, 0, 1]],
  ])("reuses every element for %s", async (_what, init, permutation) => {
    const lists = `slot xs : List(Int) = ${init}\nreducer flip on=ui.click(Flip) do= xs := xs.reverse\ntile Flip = button(text="flip")`;
    const { root } = await mounted(
      program(lists, `Flip, column(for x in xs text("item " + x.show))`),
    );
    const seen = errors();
    const items = () =>
      Array.from(root.querySelectorAll("*")).filter(
        (e) => e.childElementCount === 0 && e.textContent?.startsWith("item "),
      );
    const before = items();
    click(root, "flip");
    const after = items();
    expect(seen).toEqual([]);
    expect(after.map((e) => before.indexOf(e))).toEqual(permutation);
  });
});

describe("an insert or remove in the middle of a list that repeats a value", () => {
  const lists = (init: string, next: string) =>
    `slot xs : List(Int) = ${init}\nreducer edit on=ui.click(Edit) do= xs := ${next}\ntile Edit = button(text="edit")`;
  const loop = `Edit, column(for x in xs text("item " + x.show))`;
  const items = (root: HTMLElement) =>
    Array.from(root.querySelectorAll("*")).filter(
      (e) => e.childElementCount === 0 && e.textContent?.startsWith("item "),
    );

  it.each([
    // keys |1|7, |1|3, |2|7, |1|5 -> |1|7, |2|7, |1|5
    ["a remove", "[7, 3, 7, 5]", "[7, 7, 5]", [0, 2, 3]],
    // keys |1|7, |1|3, |2|7 -> |1|7, |2|7, |1|3, |3|7 (a newcomer)
    ["an insert", "[7, 3, 7]", "[7, 7, 3, 7]", [0, 2, 1, -1]],
  ])("keeps every surviving element through %s", async (_what, init, next, permutation) => {
    const { root } = await mounted(program(lists(init, next), loop));
    const seen = errors();
    const before = items(root);
    click(root, "edit");
    const after = items(root);
    expect(seen).toEqual([]);
    expect(after.map((e) => e.textContent)).toEqual(
      JSON.parse(next).map((x: number) => `item ${x}`),
    );
    expect(after.map((e) => before.indexOf(e))).toEqual(permutation);
  });
});

describe("an input inside a loop that repeats a value", () => {
  it("keeps its focus and caret across a re-render and a remove", async () => {
    const lists = `slot xs : List(Int) = [7, 3, 7]\nreducer drop on=ui.click(Drop) do= xs := [7, 3]\ntile Drop = button(text="drop")`;
    const { root } = await mounted(
      program(lists, `Drop, column(for x in xs row(text("item " + x.show), input()))`),
    );
    const seen = errors();
    const inputs = () => Array.from(root.querySelectorAll("input")).slice(1);
    const field = inputs()[1] as HTMLInputElement; // the row of `3`
    field.focus();
    field.value = "abc";
    field.setSelectionRange(1, 2);
    click(root, "tick");
    expect(document.activeElement).toBe(field);
    click(root, "drop");
    expect(seen).toEqual([]);
    expect(inputs()[1]).toBe(field);
    expect(document.activeElement).toBe(field);
    expect([field.value, field.selectionStart, field.selectionEnd]).toEqual(["abc", 1, 2]);
  });
});

describe("a nested for over lists that repeat a value", () => {
  it("re-renders in place", async () => {
    const lists = `slot outer : List(Int) = [1, 1]\nslot inner : List(Int) = [5, 5]`;
    const loop = `column(for o in outer row(for i in inner text("cell " + o.show + "." + i.show)))`;
    const { root } = await mounted(program(lists, loop));
    const seen = errors();
    const cells = () =>
      Array.from(root.querySelectorAll("*")).filter(
        (e) => e.childElementCount === 0 && e.textContent?.startsWith("cell "),
      );
    const before = cells();
    click(root, "tick");
    expect(seen).toEqual([]);
    expect(before.map((e) => e.textContent)).toEqual([
      "cell 1.5",
      "cell 1.5",
      "cell 1.5",
      "cell 1.5",
    ]);
    expect(cells()).toHaveLength(4);
    cells().forEach((e, i) => {
      expect(e).toBe(before[i]);
    });
  });
});

describe("a for over a list of records", () => {
  it("re-renders without a reconcile panic", async () => {
    const lists = `slot todos : List({id: Int, title: Text}) = [{id: 1, title: "a"}, {id: 2, title: "b"}]`;
    const { root } = await mounted(
      program(lists, `column(for t in todos text("todo " + t.title))`),
    );
    const seen = errors();
    click(root, "tick");
    expect(seen).toEqual([]);
    expect(root.textContent).toContain("todo a");
    expect(root.textContent).toContain("todo b");
  });
});

describe("a for whose explicit keys collide", () => {
  it("panics in reconcile on the next render, naming the key", async () => {
    const loop = `column(for s in scores text("score " + s.show) {key: s.show})`;
    const { root } = await mounted(program(SCORES, loop));
    const seen = errors();
    const input = root.querySelector("input") as HTMLInputElement;
    click(root, "tick");
    expect(seen.map((line) => line.split("\n")[0])).toEqual([
      `[kumiki] error in reconcile: reconcile: duplicate TileNode.key "7" among sibling tiles — keys must be unique within a parent's children list`,
    ]);
    // The wholesale rebuild replaced the element a keyed pass would have kept.
    expect(input.isConnected).toBe(false);
    expect(root.textContent?.match(/score 7/g)?.length).toBe(2);
  });
});
