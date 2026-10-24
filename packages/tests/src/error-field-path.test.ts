import type { AppShape } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { fill, find, mountApp } from "./helpers/dom.ts";
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
  return { app, root: mountApp(app).root };
}

function errorText(root: HTMLElement, id: string): string {
  const el = find(root, `#${id}`);
  expect(el.dataset.kumikiTile).toBe("error");
  return el.textContent ?? "";
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
    fill(root, "#email", "ada@example.com");
    expect((app.live?.form as { email: string }).email).toBe("ada@example.com");
    expect(errorText(root, "form-email")).toBe("");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
    expect(errorText(root, "form")).toBe("Must be between 0 and 120");
  });

  it("speaks for a refused value where it is shown, and only there", async () => {
    const { root } = await mounted();
    fill(root, "#email", "ada@example.com");
    fill(root, "#email", "still nope");
    expect(errorText(root, "form-email")).toBe("Invalid email format");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
  });

  it("names text an Int field cannot read on that field's tile alone", async () => {
    const { root } = await mounted();
    fill(root, "#age", "1.5");
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
  // Each element fails a different field, so a message from the wrong element reads differently.
  it.each([
    [
      "a List element's own failure while an earlier element fails too",
      "rows-0",
      "Invalid email format",
    ],
    ["a later List element's own failure", "rows-1", "Must be between 0 and 120"],
    ["nothing for an element that passes beside one that fails", "ys-0", ""],
    ["the failing element beside it", "ys-1", "Invalid email format"],
    [
      "a Map entry's own failure while another entry fails too",
      "book-b",
      "Must be between 0 and 120",
    ],
    ["a field through an element", "rows-2-email", "Invalid email format"],
    ["nothing for a passing field through the same element", "rows-2-age", ""],
  ])("says %s", async (_label, id, message) => {
    const { root } = await mounted();
    expect(errorText(root, id)).toBe(message);
  });
});

describe("error(field=…) at a path that reaches nothing in the value", () => {
  it.each([
    "none-title",
    "ys-5",
    "m-zz",
  ])("renders no message at #%s, and the page renders", async (id) => {
    const { root } = await mounted(ABSENT);
    expect(errorText(root, id)).toBe("");
  });
});
