---
"@kumikijs/compiler": patch
---

A `fn` named as a fragment is checked as the call it stands for, and `fold`'s accumulator has the init's type

`xs.map(loud)` lowers to `xs.map(loud($1))` (`language.md`), but the checker compared only how many parameters the named `fn` declared. Its parameter types went unchecked, so `loud` ran on an `Int` with nothing reported:

```
fn loud(t: Text) -> Text = t + "!"
fn shout(xs: List(Int)) -> List(Text) = xs.map(loud)
```

```
$ kumiki check a.kumiki
ok
```

The bare name is now checked as that call, in the scope where the fragment's positionals are bound, so both spellings report the same thing:

> `Expected Text but got Int` — **E0201**, at `loud` in `xs.map(loud)` and at the `$1` in `xs.map(loud($1))`

The same holds for each method a `fn` can be named in. `m.filter(keep)` over a `Map(Text, Int)` takes `fn keep(k: Text, v: Int)` and reports `fn keep(k: Int, v: Int)`. `r.map-err(f)` checks `f` against the error type. `m.update(k, f)` checks both the value `f` is handed and the value it returns.

`fold`'s accumulator `$1` had no type in either spelling, so `xs.fold(0, f)` never checked `f`'s first parameter. It now has the init's type, so a `fn step(acc: Text, x: Int)` there is E0201, and so is `xs.fold("", add($1, $2))` with `add(acc: Int, n: Int)`. An init with no type the checker can decide leaves `$1` untyped as before. One such init is `{}`, which is both the empty Map and the empty Set. A typed accumulator is also read like any other typed value. A key reader on it restores its keys: `nums.fold(counts, $1.keys…)` on a `Map(Int, _)` answers numbers instead of strings. A list literal passed where it takes a Set is built as one: `nums.fold(seen, $1.union([2]))`.

`Result.flat-map`'s `$1` is now typed as the `Ok` value, as `Option.flat-map`'s already was.

What each positional holds, per method and receiver, is one table next to the lowering's (`FRAGMENT_ARGUMENTS`). Both the checker and codegen read it, and they share the rewrite of a bare name into its call. A positional whose type cannot be decided is still checked against nothing. That covers a receiver of undecided type, a `Set`'s `filter`, and a `fold` from `{}`.
