---
"@kumikijs/compiler": minor
---

Inside a `fn`, `$1`, `$2`, ... are its arguments in order (language.md §1.6.5). `fn plus(a: Int, b: Int) -> Int = $1 + $2` returns `a + b`.

The checker accepted `$1` and `$2` in every fn body, untyped and whatever the arity, and codegen never bound them, so the first call threw `ReferenceError: _d_1 is not defined` and rolled back the reducer. Each positional now stands for the parameter at its position, with that parameter's type: `fn first(x: Int) -> Text = $1` is **E0201**, and a positional past the arity (`$1` in `fn noargs()`, `$2` in a one-parameter fn) is **E0103**. There is one per parameter, so a three-parameter fn can read `$3`. A fragment inside the body (`$1.map($1 * 2)`) keeps its own `$1` / `$2`.
