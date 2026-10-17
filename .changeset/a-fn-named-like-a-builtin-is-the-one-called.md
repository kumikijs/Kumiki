---
"@kumikijs/compiler": patch
---

A `fn` named like a built-in function is the one its calls reach

A program could declare a `fn` named `random`, `fmt`, `panic`, `file-url`,
`prefers-dark` or `run-reducer`, and nothing objected to the declaration, but
no call ever reached it. Code generation lowered every call of the name to the
built-in, so check and the running app disagreed about what the call was:

```kumiki
fn fmt(n: Int) -> Text = "custom " + n.show
fn panic(why: Text) -> Text = "soft " + why
fn run-reducer(n: Int) -> Int = n + 1

tile App = column(text(fmt(3)), text(panic("x")), text(run-reducer(3).show))
```

```
$ kumiki check app.kumiki
ok
```

Each call ran the built-in instead: `fmt(3)` rendered `3`, `panic("x")`
replaced the page with `Something went wrong: x`, and `run-reducer(3)` threw
`_init is not defined`. The checker read some of the names as the built-in
too: with `fn random() -> Int = 4`, `n := random()` into an `Int` slot was
E0201 `Expected Int but got Float`, and a `fn random` or `fn panic` taking a
different number of arguments was E0213 at every call.

Now a `fn` the program declares wins over the built-in of its name. Every call
of the name is checked against the `fn`'s signature and runs its body: in a
tile, a reducer, another `fn`, a test body, and a fragment position that names
the `fn` (`xs.map(fmt)`). The program above renders `custom 3`, `soft x` and
`4`. The checker and code generation decide which a call is from one table of
built-in callee names, so a built-in added later cannot take a call away from a
`fn` on one side only.

`run-reducer` in a property-test invariant is still the built-in where no `fn`
has that name, and `panic("…")` written on its own as a reducer statement still
stops the reducer. `now` is a reserved word, so no `fn` can be named it. A
program that declares none of these names builds exactly as before.
