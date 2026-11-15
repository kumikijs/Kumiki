import { testFile } from "@kumikijs/cli";
import { describe, expect, it } from "vitest";
import { click, fill, find, mountSource, tick } from "./helpers/dom.ts";
import { writeSource } from "./helpers/load.ts";

const SOURCE = `
type Contact = {email: Text where email, age: Int where between(0, 120)}
type Post    = {words: Int where between(1, 500), title: Text where nonempty}

slot form  : Contact                        = {email: "nope", age: 999}
slot clean : Contact                        = {email: "a@b.co", age: 36}
slot draft : Option(Post)                   = Some({words: 0, title: ""})
slot fine  : Option(Post)                   = Some({words: 0, title: "ok"})
slot bad   : Result(Post, Text where email) = Err("nope")
slot ys    : List(Text where email)         = ["a@b.co", "nope"]
slot rows  : List(Contact)                  = [{email: "nope", age: 36}, {email: "a@b.co", age: 999},
                                               {email: "x", age: 1}]
slot book  : Map(Text, Contact)             = {"a": {email: "nope", age: 36}, "b": {email: "a@b.co", age: 999}}
slot ns    : Map(Int, Text where email)     = {1: "nope", 2: "a@b.co"}
slot flags : Map(Bool, Text where nonempty) = {true: "", false: "ok"}
slot opts  : List(Option(Post))             = [Some({words: 0, title: ""})]
slot maybe : Option(List(Text where email)) = Some(["a@b.co", "nope"])
slot grid  : List(List(Text where email))   = [["a@b.co", "nope"]]
slot count : Int                            = 0

reducer bump   on=ui.click(Bump)   do= count := count + 1
reducer shrink on=ui.click(Shrink) do= rows := []

tile Bump   = button(text="bump")
tile Shrink = button(text="shrink")

tile App = column(
    Bump, Shrink, text(count),
    input(bind=form.email, id="email"),
    input(bind=form.age, type="number", id="age"),
    input(bind=clean.email, id="clean-email"),
    error(field=form.email, id="form-email"),
    error(field=form.age, id="form-age"),
    error(field=form, id="form"),
    error(field=clean.email, id="clean-email-error"),
    error(field=clean.age, id="clean-age-error"),
    error(field=draft, id="draft"),
    error(field=draft.get.title, id="draft-title"),
    error(field=fine.get.title, id="fine-title"),
    error(field=bad, id="bad"),
    error(field=bad.get.title, id="bad-title"),
    error(field=ys[0], id="ys-0"),
    error(field=ys[1], id="ys-1"),
    error(field=rows[0], id="rows-0"),
    error(field=rows[1], id="rows-1"),
    error(field=rows[2].email, id="rows-2-email"),
    error(field=rows[2].age, id="rows-2-age"),
    error(field=book["b"], id="book-b"),
    error(field=book["b"].age, id="book-b-age"),
    error(field=ns[1], id="ns-1"),
    error(field=ns[2], id="ns-2"),
    error(field=flags[true], id="flags-true"),
    error(field=flags[false], id="flags-false"),
    error(field=opts[0].get.title, id="opts-0-title"),
    error(field=maybe.get[1], id="maybe-1"),
    error(field=grid[0][1], id="grid-0-1"))

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
    error(field=ys[-1], id="ys-minus-1"),
    error(field=m["zz"], id="m-zz"))

app ErrorFieldAbsent
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

function errorText(root: HTMLElement, id: string): string {
  const el = find(root, `#${id}`);
  expect(el.dataset.kumikiTile).toBe("error");
  return el.textContent ?? "";
}

describe("error(field=<slot>.<field>) on a record whose fields both fail", () => {
  it("says each field's own message, and the slot's tile the first", async () => {
    const { root } = await mountSource(SOURCE);
    expect(errorText(root, "form-email")).toBe("Invalid email format");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
    expect(errorText(root, "form")).toBe("Invalid email format");
  });

  it("drops a field's message once that field passes, and keeps its sibling's", async () => {
    const { app, root } = await mountSource(SOURCE);
    fill(root, "#email", "ada@example.com");
    expect((app.live?.form as { email: string }).email).toBe("ada@example.com");
    expect(errorText(root, "form-email")).toBe("");
    expect(errorText(root, "form-age")).toBe("Must be between 0 and 120");
    expect(errorText(root, "form")).toBe("Must be between 0 and 120");
  });

  it("speaks for a refused value where it is shown, and only there", async () => {
    const { root } = await mountSource(SOURCE);
    fill(root, "#clean-email", "nope");
    expect(errorText(root, "clean-email-error")).toBe("Invalid email format");
    expect(errorText(root, "clean-age-error")).toBe("");
  });

  it("names text an Int field cannot read on that field's tile and the slot's", async () => {
    const { root } = await mountSource(SOURCE);
    fill(root, "#age", "1.5");
    expect(errorText(root, "form-age")).toBe("Must be a whole number");
    expect(errorText(root, "form")).toBe("Must be a whole number");
    expect(errorText(root, "form-email")).toBe("Invalid email format");
  });
});

describe("error(field=…) through .get", () => {
  it.each([
    ["the payload's field, not the payload's first failure", "draft-title", "Required"],
    ["the payload's first failure for the whole slot", "draft", "Must be between 1 and 500"],
    ["nothing for a payload field that passes beside one that fails", "fine-title", ""],
    ["nothing for an Ok payload's field when the slot holds an Err", "bad-title", ""],
    ["the Err payload's failure for the whole slot", "bad", "Invalid email format"],
  ])("says %s", async (_label, id, message) => {
    const { root } = await mountSource(SOURCE);
    expect(errorText(root, id)).toBe(message);
  });
});

describe("error(field=…) at a literal index", () => {
  // Each element fails a different field, so a message from the wrong element reads differently.
  it.each([
    ["the first List element's own failure", "rows-0", "Invalid email format"],
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
    ["a field through a Map entry", "book-b-age", "Must be between 0 and 120"],
    ["an Int key's entry", "ns-1", "Invalid email format"],
    ["nothing for an Int key's entry that passes", "ns-2", ""],
    ["a Bool key's entry", "flags-true", "Required"],
    ["nothing for a Bool key's entry that passes", "flags-false", ""],
    ["an Option's payload field through an element", "opts-0-title", "Required"],
    ["an element through an Option's payload", "maybe-1", "Invalid email format"],
    ["an element of an element", "grid-0-1", "Invalid email format"],
  ])("says %s", async (_label, id, message) => {
    const { root } = await mountSource(SOURCE);
    expect(errorText(root, id)).toBe(message);
  });

  it("keeps each path's message when another slot's reducer re-renders the page", async () => {
    const { app, root } = await mountSource(SOURCE);
    click(root, "bump");
    await tick(0);
    expect(app.live?.count).toBe(1);
    expect(errorText(root, "rows-0")).toBe("Invalid email format");
    expect(errorText(root, "rows-1")).toBe("Must be between 0 and 120");
    expect(errorText(root, "rows-2-age")).toBe("");
  });

  it("renders nothing once the List shrinks below an indexed path", async () => {
    const { app, root } = await mountSource(SOURCE);
    click(root, "shrink");
    await tick(0);
    expect(app.live?.rows).toEqual([]);
    expect(errorText(root, "rows-1")).toBe("");
    expect(errorText(root, "rows-2-email")).toBe("");
  });
});

describe("error(field=…) at a path that reaches nothing in the value", () => {
  it.each([
    "none-title",
    "ys-5",
    "ys-minus-1",
    "m-zz",
  ])("renders no message at #%s, and the page renders", async (id) => {
    const { root } = await mountSource(ABSENT);
    expect(errorText(root, id)).toBe("");
  });
});

describe("a tile-test of error(field=form.email)", () => {
  const source = (expected: string): string => `
type Contact = {email: Text where email, age: Int where between(0, 120)}
slot form : Contact = {email: "", age: 0}
tile E = error(field=form.email)

app ErrorFieldTileTest
    caps   = []
    routes = {"/" -> E, "/404" -> E}
    init   = []

test shows =
    tile-test E
        given  = {slots: {form: {email: "", age: 0}}}
        expect = ${expected}`;

  it.each([
    ["passes", "the same path", "form.email", true],
    ["fails", "the whole slot", "form", false],
    ["fails", "a sibling's path", "form.age", false],
  ])("%s an expected error tile at %s", async (_verdict, _label, field, pass) => {
    const path = writeSource(`error-field-path/${field}`, source(`error(field=${field})`));
    const [result] = await testFile(path);
    expect(result?.pass).toBe(pass);
  });
});
