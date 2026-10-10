---
"@kumikijs/compiler": patch
---

`Time.now` is the builtin `now`

stdlib.md lists `Time.now : Time`, but only the bare keyword `now` was
implemented. `Time.now` parsed as a field read on a variant named `Time`, so it
had no type and lowered to `(({ _tag: "Time" }))["now"]`, which is `undefined`.
`check` and `smoke` passed, a `Time` slot initialised with it formatted as
`0NaN-NaN-NaN NaN:NaN`, and `fn flag() -> Bool = Time.now` was accepted where
`fn flag() -> Bool = now` is E0201. `Time.now()` was E0116.

```
slot started : Time = Time.now
fn flag() -> Bool = Time.now
```

```
before: ok
after:  E0201 type-mismatch at 2:21: Expected Bool but got Time
```

The parser now reads `Time.now` and `Time.now()` as a call to `now` itself, so
the type, the argument count and the lowering (`_s.now()`) are the ones `now`
has. A reducer that reads `Time.now` records a `now` environment read in its
episode, and a replay hands the recorded instant back, as for `now`.
`Time.now(1)` is E0213 (`Function "now" expects 0 argument(s) but got 1`).

Reading `Time.<member>` as a call also applies to the other members of `Time`
written without parentheses. Before, each was a field read that evaluated to
`undefined` with no diagnostic. Now each gets the diagnostic its parenthesised
spelling gets:

> `Call to undefined function "Time.nope"` — **E0116**
>
> `Function "Time.parse" expects 1 argument(s) but got 0` — **E0213** (and the
> same for `Time.show`)
>
> `"Time" is not a Text, and fresh mints a uuid Text — declare the id nominal
> Text` — **E0802** for `Time.fresh`

`Time.parse(text)`, `Time.show(v)` and the other type members on `Time` are
unchanged. `kumiki fix` offers `Time.now` for a misspelling such as
`Time.nwo`. A type declared over `Time` (`type Stamp = nominal Time`) has no
`now` member, and `Stamp.now()` is still E0116.
