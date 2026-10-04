// A `bind=` target is a slot, or a field path into one (forms.md §5.1). The
// control writes back to the slot its target's root names, so a root that is
// not a slot where the target is written — a `for` variable, a tile's `$1`, a
// literal — is E0229 at the target: the lowering would write the root's name
// into the live slot table as a slot of its own that nothing reads, or drop
// the bind, and the field would take edits that reach nothing. The scenario
// beside `224-bind-root-is-a-slot` drives the supported forms through the DOM;
// what is here is the checker's answer for the forms that write nowhere, and
// for their neighbours that write a slot.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const APP = `
app A
    caps   = []
    routes = {"/" -> P, "/404" -> P}
    init   = []
`;

const diagnostics = (source: string) => check(parse(lex(source)));

describe("a bind target whose root is not a slot", () => {
  it("is E0229 at the target, naming the root and what it is", () => {
    const source = `type Todo = {text: Text}
slot todos : List(Todo) = [{text: "milk"}]
slot title : Text = "t"
tile Row in=Text = input(bind=$1, id="row")
tile P = column(
  for t in todos input(bind=t.text, id="fx"),
  Row(title),
  input(bind="title", id="lit"),
  text("todos=" + todos.map($1.text).join(",")),
  text("title=" + title))
${APP}`;
    const reported = diagnostics(source).map((d) => [d.code, d.kind, d.pos, d.message]);
    const tail = "a bind writes back to a slot or a field path into one";
    const see = "(see docs/spec/forms.md §5.1)";
    expect(reported).toEqual([
      [
        "E0229",
        "bind-target-not-slot",
        { line: 4, col: 31 },
        `input(bind=…) cannot write to "$1": it is this tile's input, not a slot — ${tail}. Bind the slot by its name, or show $1 with value= and write the slot from a reducer ${see}`,
      ],
      [
        "E0229",
        "bind-target-not-slot",
        { line: 6, col: 29 },
        `input(bind=…) cannot write to "t": it is the variable of a for, not a slot — ${tail}. To edit a row, show it with value= and update the list from a reducer ${see}`,
      ],
      [
        "E0229",
        "bind-target-not-slot",
        { line: 8, col: 14 },
        `input(bind=…) cannot write to the text literal "title": a literal is a value, not a slot — ${tail}. Write the slot's name without quotes: bind=title ${see}`,
      ],
    ]);
  });
});

describe("a bind target whose root is a slot", () => {
  const HEAD = `type Filter = All | Active
type Addr = {city: Text}
type Form = {email: Text, age: Int, addr: Addr, agree: Bool, size: Filter}
type D = {title: Text}
slot name : Text = "a"
slot n : Int = 1
slot flag : Bool = false
slot filter : Filter = All
slot form : Form = {email: "e", age: 1, addr: {city: "c"}, agree: false, size: All}
slot d : Option(D) = Some({title: "a"})
slot limit : Option(Int) = Some(3)
slot xs : List(Text) = ["a"]
`;
  it.each([
    [
      "a slot, on every control that binds",
      `tile P = column(
  input(bind=name), input(bind=n, type="number"), textarea(bind=name),
  select(bind=filter, options=[{label: "All", value: All}]), slider(bind=n, min=0, max=9),
  check(bind=flag), switch(bind=flag), radio(group="g", bind=filter, value=Active),
  editable("x", bind=name))`,
    ],
    [
      "a field path into one",
      `tile P = column(input(bind=form.email), input(bind=form.age, type="number"),
  check(bind=form.agree), radio(group="g", bind=form.size, value=All))`,
    ],
    [
      "a nested field path",
      `tile P = column(input(bind=form.addr.city), textarea(bind=form.addr.city))`,
    ],
    [
      "an Option's payload, through .get",
      `tile P = column(input(bind=d.get.title), input(bind=limit.get, type="number"))`,
    ],
    [
      "a slot named inside a tile that takes an input, called from a for",
      `tile Field in=Text = column(label(text=$1), input(bind=form.email), input(bind=name))
tile P = column(Field("Email"), for x in xs Field(x))`,
    ],
  ])("checks clean: %s", (_label, tiles) => {
    expect(diagnostics(`${HEAD}${tiles}${APP}`)).toEqual([]);
  });
});
