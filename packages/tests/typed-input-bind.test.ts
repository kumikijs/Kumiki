// An `input` bound to an `Int` / `Float` / `Time` slot reads its text as a
// value of that type before writing it (forms.md §5.1.1): the renderer used to
// write `inp.value` — always a string — straight into the slot, so an `Int`
// held `"5"` and `age + 1` rendered `51`. The scenario beside
// `133-typed-input-bind` drives the slot values; what is here is what it
// cannot see — the type of what was stored, what the field keeps showing after
// a refusal, and the text a date field is given.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "133-typed-input-bind.kumiki");

function field(root: HTMLElement, id: string): HTMLInputElement {
  const inp = root.querySelector<HTMLInputElement>(`#${id}`);
  if (!inp) throw new Error(`#${id} not found`);
  return inp;
}

function fill(root: HTMLElement, id: string, value: string): void {
  const inp = field(root, id);
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountInto(app: AppShape): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return root;
}

describe("input bind reads its text as the slot's type", () => {
  it("stores an Int as an Int, and arithmetic on it adds", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "age", "5");
    expect(app.live?.age).toBe(5);
    expect(root.textContent).toContain("next=6");
  });

  it("refuses text that is no Int, keeping the slot and what was typed", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "age", "5");
    fill(root, "age", "");
    expect(app.live?.age).toBe(5);
    expect(field(root, "age").value).toBe("");
    fill(root, "age", "1.5");
    expect(app.live?.age).toBe(5);
    expect(field(root, "age").value).toBe("1.5");
  });

  it("stores a Float, and leaves text that reads as it alone", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "price", "2.50");
    expect(app.live?.price).toBe(2.5);
    // "2.50" already shows 2.5; rewriting it to "2.5" would move the caret.
    expect(field(root, "price").value).toBe("2.50");
  });

  it("reads a record field bound through a path by the field's type", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    fill(root, "qty", "3");
    expect(app.live?.order).toEqual({ qty: 3, note: "" });
  });

  it("stores a date as an instant and shows the slot as a date", async () => {
    const app = await loadApp(example);
    const root = mountInto(app);
    expect(field(root, "day").value).toBe("2026-01-01");
    fill(root, "day", "2026-03-04");
    expect(app.live?.day).toBe(new Date(2026, 2, 4).getTime());
    const next = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "next day",
    );
    next?.click();
    expect(field(root, "day").value).toBe("2026-03-05");
  });

  it("holds a read value to the slot's refinement, and says why", async () => {
    const app = await loadSource(`
slot n : Int where between(0, 120) = 0
tile App = column(input(bind=n, type="number", id="n"), error(field=n))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const root = mountInto(app);
    fill(root, "n", "7");
    expect(app.live?.n).toBe(7);
    fill(root, "n", "130");
    expect(app.live?.n).toBe(7);
    expect(field(root, "n").value).toBe("130");
    expect(root.textContent).toContain("Must be between 0 and 120");
  });
});
