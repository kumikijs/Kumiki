// `sort-by(expr)` orders a list by `expr` the way `<` orders two values
// (stdlib.md §2.2.3, language.md §1.9.4): numbers, Text and Time have an
// order, and nothing else does. A key without one used to pass `check` and
// leave the list as it found it at runtime, so the checker reports it as the
// comparison it stands for.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// `decls` are extra top-level definitions; `res` takes whatever type `out` names.
const diagnostics = (rhs: string, decls = "", out = "List(User)") =>
  check(
    parse(
      lex(`type Kind = Admin | Guest
type User = {name: Text, age: Int, born: Time, admin: Bool, kind: Kind, tags: List(Text)}
slot users : List(User) = []
slot byId : Map(Text, User) = {}
slot ids : List(Text) = []
slot res : ${out} = []
${decls}
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

  it("is accepted on a Map's entries ordered by a field of the value ($2)", () => {
    expect(diagnostics("byId.entries.sort-by($2.born).map($1)", "", "List(Text)")).toEqual([]);
  });

  it("is E0201 on a Map's entries ordered by a value with no order ($2)", () => {
    expect(diagnostics("byId.entries.sort-by($2).map($1)", "", "List(Text)")).toEqual([
      `E0201 ".sort-by" orders by its key as "<" does, which needs a number, Text or Time, but the key is User`,
    ]);
  });

  it("is E0201 when it is an Option, which `<` does not order", () => {
    expect(diagnostics("ids.sort-by(byId.get($1))", "", "List(Text)")).toEqual([
      `E0201 ".sort-by" orders by its key as "<" does, which needs a number, Text or Time, but the key is Option(User)`,
    ]);
  });

  it("is left alone when the checker cannot type it", () => {
    // What `.fold` answers is decided by its lambda body, which the checker
    // does not infer (errors.md §E0201, "the check is one-sided"). This key is
    // an Int at runtime and the program is clean; the silence is the contract.
    expect(diagnostics("users.sort-by($1.tags.fold(0, $1 + 1))")).toEqual([]);
  });

  it("is left alone when it is a fn with no declared return type", () => {
    // The key is a variant and will not sort, but with no `->` there is no
    // type to read it from; until a fn's return type is inferred this stays a
    // missing diagnostic rather than a wrong one.
    expect(
      diagnostics("users.sort-by(kindOf)", "fn kindOf(u: User) = u.kind").join("\n"),
    ).not.toContain("E0201");
  });
});

// A `fn` passed by name is applied to the element (`xs.sort-by(keyOf)` is
// `xs.sort-by(keyOf($1))`), so the key is what the fn declares it returns.
describe("the key of sort-by given as a fn name", () => {
  it.each([
    ["Text", "fn nameOf(u: User) -> Text = u.name"],
    ["Int", "fn ageOf(u: User) -> Int = u.age"],
    ["Time", "fn bornOf(u: User) -> Time = u.born"],
  ])("is accepted when the fn returns %s", (_what, decl) => {
    const name = decl.split(/[ (]/)[1];
    expect(diagnostics(`users.sort-by(${name})`, decl)).toEqual([]);
  });

  it.each([
    ["a variant", "fn kindOf(u: User) -> Kind = u.kind", "kindOf", "Kind"],
    ["a record", "fn whole(u: User) -> User = u", "whole", "User"],
    ["a Bool", "fn adminOf(u: User) -> Bool = u.admin", "adminOf", "Bool"],
  ])("is E0201 when the fn returns %s", (_what, decl, name, shown) => {
    expect(diagnostics(`users.sort-by(${name})`, decl)).toEqual([
      `E0201 ".sort-by" orders by its key as "<" does, which needs a number, Text or Time, but the key is ${shown}`,
    ]);
  });

  it("reports only the arity of a fn that does not fit, not its key as well", () => {
    expect(
      diagnostics("users.sort-by(pairKind)", "fn pairKind(a: User, b: User) -> Kind = a.kind"),
    ).toEqual([expect.stringMatching(/^E0213 Function "pairKind" expects 2 argument\(s\)/)]);
  });
});
