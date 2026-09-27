// `sort-by(expr)` orders a list by `expr` the way `<` orders two values
// (stdlib.md §2.2.3, language.md §1.9.4): numbers, Text and Time have an
// order, and nothing else does. A key without one used to pass `check` and
// leave the list as it found it at runtime, so the checker reports it as the
// comparison it stands for.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const diagnostics = (rhs: string) =>
  check(
    parse(
      lex(`type Kind = Admin | Guest
type User = {name: Text, age: Int, born: Time, admin: Bool, kind: Kind, tags: List(Text)}
slot users : List(User) = []
slot res : List(User) = []
reducer act on=ui.click(Btn)
    do= res := ${rhs}
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`),
    ),
  ).map((e) => `${e.code} ${e.message}`);

describe("the key sort-by orders by", () => {
  it.each([
    ["a Text field", "users.sort-by($1.name)"],
    ["an Int field", "users.sort-by($1.age)"],
    ["a Time field", "users.sort-by($1.born)"],
  ])("is accepted when it is %s", (_what, rhs) => {
    expect(diagnostics(rhs)).toEqual([]);
  });

  it.each([
    ["a record", "users.sort-by($1)", "User"],
    ["a variant", "users.sort-by($1.kind)", "Kind"],
    ["a Bool", "users.sort-by($1.admin)", "Bool"],
    ["a List", "users.sort-by($1.tags)", "List(Text)"],
  ])("is E0201 when it is %s, which has no order", (_what, rhs, shown) => {
    expect(diagnostics(rhs)).toEqual([
      `E0201 ".sort-by" orders by its key as "<" does, which needs a number, Text or Time, but the key is ${shown}`,
    ]);
  });
});
