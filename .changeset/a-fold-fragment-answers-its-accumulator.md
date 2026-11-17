---
"@kumikijs/compiler": minor
---

Check what a `fold` fragment answers against its accumulator, whose type is the wider of the init's type and the fragment's result

A `fold` fragment's result was never checked against the accumulator. From the second element on, `$1` held whatever the fragment had returned:

```kumiki
slot xs : List(Int) = [1, 2, 3]
slot t  : Text      = ""
fn step(acc: Int, x: Int) -> Text = (acc + x).show
reducer go on=ui.click(Go)
    do= t := xs.fold(0, step)
tile Go = button(text="go")
tile App = column(Go, text(t))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
```

```
$ kumiki check a.kumiki
ok
```

After a click the page showed `123`, not `6`: `step` was declared to take an `Int` accumulator and from its second call on was handed the `Text` the previous call returned. `xs.fold(0, $1.show)` passed the same way.

The accumulator's type is now the wider of the init's type and the fragment's result type (language.md, stdlib.md), and the fragment is checked against it. Both programs above are **E0201** `Expected Int but got Text`, at `step` in `xs.fold(0, step)` and at `$1.show` in `xs.fold(0, $1.show)`. An `Int` init that the fragment answers a `Float` from is a `Float` accumulator, so `ps.fold(0, $1 + $2)` over a `List(Float)` still passes, and `$1` is a `Float` at every step. A `fn` whose accumulator parameter is narrower than what it answers, such as `fn grow(acc: Int, p: Float) -> Float`, is therefore E0201 at its name. An init that leaves a type open, `[]` or `None`, takes the type the fragment fills it with, so `xs.fold([], step)` with `fn step(acc: List(Text), x: Int) -> List(Int)` is E0201 at `step` too. A widened accumulator is read again as the next `$1`, until the fragment answers no wider type, at most four times.

Where the init and the result do not fit each other, the accumulator keeps the init's type, so a fold that was already refused for its init can now report the result as well. `xs.fold("", step)` with `fn step(acc: Int, x: Int) -> Int` reports `Expected Int but got Text` for the init and `Expected Text but got Int` for the result. An init with no type of its own, `{}`, still leaves the accumulator untyped and unchecked.
