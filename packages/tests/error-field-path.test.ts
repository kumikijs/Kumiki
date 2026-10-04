// `error(field=…)` names a slot or a path into one (forms.md §5.7.1), and a
// path's tile renders the message of the first failure at or below it — the
// failure a bind to that path is refused for (§5.6). A record slot is gated by
// its fields' predicates, so this tile is the one place a field's failure
// reaches the page: each tile below sits beside a sibling that also fails, and
// says its own field's message, not the sibling's and not nothing.

import { type AppShape, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const SOURCE = `
type Contact = {email: Text where email, age: Int where between(0, 120)}
type Post    = {title: Text where nonempty}

slot form  : Contact                = {email: "nope", age: 999}
slot draft : Option(Post)           = Some({title: ""})
slot ys    : List(Text where email) = ["a@b.co", "nope"]
slot rows  : List(Contact)          = [{email: "nope", age: 36}, {email: "a@b.co", age: 999},
                                       {email: "x", age: 1}]
slot book  : Map(Text, Contact)     = {"a": {email: "nope", age: 36}, "b": {email: "a@b.co", age: 999}}

tile App = column(
    input(bind=form.email, id="email"),
    input(bind=form.age, type="number", id="age"),
    error(field=form.email, id="form-email"),
    error(field=form.age, id="form-age"),
    error(field=form, id="form"),
    error(field=draft.get.title, id="draft-title"),
    error(field=ys[0], id="ys-0"),
    error(field=ys[1], id="ys-1"),
    error(field=rows[0], id="rows-0"),
    error(field=rows[1], id="rows-1"),
    error(field=rows[2].email, id="rows-2-email"),
    error(field=rows[2].age, id="rows-2-age"),
    error(field=book["b"], id="book-b"))

app ErrorFieldPath
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

// A path that reaches nothing in the value — an empty Option's payload, an
// index past a List's end, a key the Map does not hold — names a place, not a
// value, so the tile reads nothing there: it renders no message, and a read
// that would panic is never made.
const ABSENT = `
type Post = {title: Text where nonempty}

slot none : Option(Post)                   = None
slot ys   : List(Text where email)         = ["a@b.co", "nope"]
slot m    : Map(Text, Text where nonempty) = {"a": ""}

tile App = column(
    error(field=none.get.title, id="none-title"),
    error(field=ys[5], id="ys-5"),
    error(field=m["zz"], id="m-zz"))

app ErrorFieldAbsent
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

afterEach(() => {
  document.body.replaceChildren();
});

async function mounted(source = SOURCE): Promise<{ app: AppShape; root: HTMLElement }> {
  const app = await loadSource(source);
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return { app, root };
}

function errorText(root: HTMLElement, id: string): string {
  const el = root.querySelector(`#${id}`);
  if (!el) throw new Error(`#${id} not found`);
  expect((el as HTMLElement).dataset.kumikiTile).toBe("error");
  return el.textContent ?? "";
}

function fill(root: HTMLElement, id: string, value: string): void {
  const inp = root.querySelector<HTMLInputElement>(`#${id}`);
  if (!inp) throw new Error(`#${id} not found`);
  inp.value = value;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("error(field=<slot>.<field>) on a record whose fields both fail", () => {
  it("says each field's own message, and the slot's tile the first", async () => {
    const { root } = await mounted();
    expect(errorText(root, "form-email")).toBe("Invalid email format");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
    expect(errorText(root, "form")).toBe("Invalid email format");
  });

  it("drops a field's message once that field passes, and keeps its sibling's", async () => {
    const { app, root } = await mounted();
    fill(root, "email", "ada@example.com");
    expect((app.live?.form as { email: string }).email).toBe("ada@example.com");
    expect(errorText(root, "form-email")).toBe("");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
    expect(errorText(root, "form")).toBe("Must be between 0 and 120");
  });

  it("speaks for a refused value where it is shown, and only there", async () => {
    const { root } = await mounted();
    fill(root, "email", "ada@example.com");
    fill(root, "email", "still nope"); // refused: the field keeps showing it
    expect(errorText(root, "form-email")).toBe("Invalid email format");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
  });

  it("names text an Int field cannot read on that field's tile alone", async () => {
    const { root } = await mounted();
    fill(root, "age", "1.5");
    expect(errorText(root, "form-age")).toBe("Must be a whole number");
    expect(errorText(root, "form")).toBe("Must be a whole number");
    expect(errorText(root, "form-email")).toBe("Invalid email format");
  });
});

describe("error(field=…) through an Option's payload", () => {
  it("names the payload's field when there is one", async () => {
    const { root } = await mounted();
    expect(errorText(root, "draft-title")).toBe("Required");
  });
});

describe("error(field=…) at a literal index", () => {
  // Each element fails a different field, so a message that came from the
  // wrong element reads differently from the right one.
  it("names a List element's own failure while an earlier element fails too", async () => {
    const { root } = await mounted();
    expect(errorText(root, "rows-0")).toBe("Invalid email format");
    expect(errorText(root, "rows-1")).toBe("Must be between 0 and 120");
  });

  it("says nothing for an element that passes beside one that fails", async () => {
    const { root } = await mounted();
    expect(errorText(root, "ys-0")).toBe("");
    expect(errorText(root, "ys-1")).toBe("Invalid email format");
  });

  it("names a Map entry's own failure while another entry fails too", async () => {
    const { root } = await mounted();
    expect(errorText(root, "book-b")).toBe("Must be between 0 and 120");
  });

  it("follows a path through an element into its fields", async () => {
    const { root } = await mounted();
    expect(errorText(root, "rows-2-email")).toBe("Invalid email format");
    expect(errorText(root, "rows-2-age")).toBe("");
  });
});

describe("error(field=…) at a path that reaches nothing in the value", () => {
  it("renders no message, and the page renders", async () => {
    const { root } = await mounted(ABSENT);
    expect(errorText(root, "none-title")).toBe("");
    expect(errorText(root, "ys-5")).toBe("");
    expect(errorText(root, "m-zz")).toBe("");
  });
});
