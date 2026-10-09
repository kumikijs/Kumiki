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

/** What `error(field=<slot>)` shows. */
function errorText(root: HTMLElement, slot: string): string {
  const el = root.querySelector(`[data-kumiki-tile="error"][data-field="${slot}"]`);
  if (!el) throw new Error(`error(field=${slot}) not found`);
  return el.textContent ?? "";
}

function click(root: HTMLElement, text: string): void {
  const button = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
  if (!button) throw new Error(`button "${text}" not found`);
  button.click();
}

const program = (body: string): string => `${body}
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

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
    click(root, "next day");
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

describe("text that reads as no value of the bound type says why (forms.md §5.7.2)", () => {
  it("gives an unrefined Int slot a message, and keeps the slot on its last value", async () => {
    const app = await loadSource(
      program(`
slot age : Int = 0
tile App = column(input(bind=age, type="number", id="age"), error(field=age))`),
    );
    const root = mountInto(app);
    fill(root, "age", "5");
    expect(errorText(root, "age")).toBe("");
    fill(root, "age", "");
    expect(app.live?.age).toBe(5);
    expect(errorText(root, "age")).toBe("Must be a whole number");
    fill(root, "age", "1.5");
    expect(app.live?.age).toBe(5);
    expect(field(root, "age").value).toBe("1.5");
    expect(errorText(root, "age")).toBe("Must be a whole number");
    fill(root, "age", "6");
    expect(app.live?.age).toBe(6);
    expect(errorText(root, "age")).toBe("");
  });

  it("names the reading before the refinement on a refined slot", async () => {
    const app = await loadSource(
      program(`
slot n : Int where between(0, 120) = 0
tile App = column(input(bind=n, type="number", id="n"), error(field=n))`),
    );
    const root = mountInto(app);
    fill(root, "n", "1.5");
    expect(app.live?.n).toBe(0);
    expect(errorText(root, "n")).toBe("Must be a whole number");
    fill(root, "n", "130");
    expect(errorText(root, "n")).toBe("Must be between 0 and 120");
  });

  it("has a message for a Float and for a Time too", async () => {
    const app = await loadSource(
      program(`
slot price : Float = 1.0
slot day   : Time  = Time.parse("2026-01-01").get-or(now)
tile App = column(
    input(bind=price, type="number", id="price"), error(field=price),
    input(bind=day, type="date", id="day"), error(field=day))`),
    );
    const root = mountInto(app);
    fill(root, "price", "");
    fill(root, "day", "");
    expect(app.live?.price).toBe(1);
    expect(app.live?.day).toBe(new Date(2026, 0, 1).getTime());
    expect(errorText(root, "price")).toBe("Must be a number");
    expect(errorText(root, "day")).toBe("Must be a date");
  });

  it("takes the message from theme.errors when the theme overrides it", async () => {
    const app = await loadSource(`
slot age : Int = 0
tile App = column(input(bind=age, type="number", id="age"), error(field=age))
theme Plain = { errors: { int: "Whole numbers only" } }
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
    theme  = Plain
`);
    const root = mountInto(app);
    fill(root, "age", "1.5");
    expect(errorText(root, "age")).toBe("Whole numbers only");
  });

  it("reads a number field exactly as T.parse reads text", async () => {
    const app = await loadSource(
      program(`
slot price : Float = 1.0
slot n     : Int   = 0
tile App = column(
    input(bind=price, type="number", id="price"), error(field=price),
    input(bind=n, type="number", id="n"), error(field=n))`),
    );
    const root = mountInto(app);
    fill(root, "price", ".5");
    expect(app.live?.price).toBe(1);
    expect(errorText(root, "price")).toBe("Must be a number");
    fill(root, "price", "1e3");
    expect(app.live?.price).toBe(1000);
    expect(errorText(root, "price")).toBe("");
    fill(root, "n", "1e3");
    expect(app.live?.n).toBe(0);
    expect(errorText(root, "n")).toBe("Must be a whole number");
  });

  it("speaks for a path bind's field, on the slot it binds through", async () => {
    const app = await loadSource(
      program(`
type Order = {qty: Int, note: Text}
slot order : Order = {qty: 1, note: ""}
tile App = column(input(bind=order.qty, type="number", id="qty"), error(field=order))`),
    );
    const root = mountInto(app);
    fill(root, "qty", "x1");
    expect(app.live?.order).toEqual({ qty: 1, note: "" });
    expect(errorText(root, "order")).toBe("Must be a whole number");
  });
});

describe("the bound position's type is followed through payloads and aliases", () => {
  it("reads an Option's payload through .get", async () => {
    const app = await loadSource(
      program(`
type Line = {qty: Int}
slot line  : Option(Line) = Some({qty: 1})
slot limit : Option(Int)  = Some(2)
tile App = column(
    input(bind=line.get.qty, type="number", id="qty"),
    input(bind=limit.get, type="number", id="limit"))`),
    );
    const root = mountInto(app);
    fill(root, "qty", "3");
    expect(app.live?.line).toEqual({ _tag: "Some", _0: { qty: 3 } });
    fill(root, "limit", "4");
    expect(app.live?.limit).toEqual({ _tag: "Some", _0: 4 });
    fill(root, "limit", "4.5");
    expect(app.live?.limit).toEqual({ _tag: "Some", _0: 4 });
  });

  it("reads a Result's Ok payload through .get", async () => {
    const app = await loadSource(
      program(`
slot res : Result(Float, Text) = Ok(1.0)
tile App = column(input(bind=res.get, type="number", id="res"))`),
    );
    const root = mountInto(app);
    fill(root, "res", "2.5");
    expect(app.live?.res).toEqual({ _tag: "Ok", _0: 2.5 });
  });

  it("reads an alias and a nominal by the base they unalias to", async () => {
    const app = await loadSource(
      program(`
type Qty   = Int where positive
type Cents = nominal Int
slot qty   : Qty   = 1
slot cents : Cents = 0
tile App = column(
    input(bind=qty, type="number", id="qty"), error(field=qty),
    input(bind=cents, type="number", id="cents"))`),
    );
    const root = mountInto(app);
    fill(root, "qty", "3");
    expect(app.live?.qty).toBe(3);
    fill(root, "cents", "250");
    expect(app.live?.cents).toBe(250);
    fill(root, "qty", "0");
    expect(app.live?.qty).toBe(3);
    expect(errorText(root, "qty")).toBe("Must be positive");
    fill(root, "qty", "x");
    expect(errorText(root, "qty")).toBe("Must be a whole number");
  });
});

describe("a date field shows the local day", () => {
  it("of an evening instant, which is the next day in UTC", async () => {
    const app = await loadSource(
      program(`
slot at : Time = Time.parse("2026-01-01T20:00").get-or(now)
tile App = column(input(bind=at, type="date", id="at"))`),
    );
    const root = mountInto(app);
    expect(field(root, "at").value).toBe("2026-01-01");
  });
});

describe("a datetime-local field bound to a Time", () => {
  const source = program(`
slot at : Time = Time.parse("2026-01-01T09:30").get-or(now)
tile LaterBtn = button(text="later")
reducer later on=ui.click(LaterBtn) do= at := at.plus(Duration.h(1))
tile App = column(input(bind=at, type="datetime-local", id="at"), LaterBtn)`);

  it("shows the instant as yyyy-MM-ddTHH:mm on the local clock", async () => {
    const app = await loadSource(source);
    const root = mountInto(app);
    expect(app.live?.at).toBe(new Date(2026, 0, 1, 9, 30).getTime());
    expect(field(root, "at").value).toBe("2026-01-01T09:30");
  });

  it("stores what is typed as that local minute, and follows a reducer", async () => {
    const app = await loadSource(source);
    const root = mountInto(app);
    fill(root, "at", "2026-03-04T10:15");
    expect(app.live?.at).toBe(new Date(2026, 2, 4, 10, 15).getTime());
    click(root, "later");
    expect(app.live?.at).toBe(new Date(2026, 2, 4, 11, 15).getTime());
    expect(field(root, "at").value).toBe("2026-03-04T11:15");
  });
});
