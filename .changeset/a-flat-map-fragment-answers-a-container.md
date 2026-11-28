---
"@kumikijs/compiler": patch
---

A `flat-map` fragment is checked to answer an `Option` or a `Result` of the receiver's error type, and a `filter` predicate to answer a `Bool`.

On a `Some` / `Ok`, `flat-map` hands back what its fragment answers as it is. The checker looked at the fragment's positionals but not at what it answered, so a fragment that answered a bare value passed `check`, and the `Option` slot the call was written to held that value:

```
slot o : Option(Int) = Some(1)
slot m : Option(Int) = None
reducer bump on=ui.click(B) do= m := o.flat-map($1 + 1)
```

```
$ kumiki check a.kumiki
ok
```

After the click `m` held `2`, which is neither `Some(2)` nor `None`: `m.is-some` rendered `false` and `m.get-or(0)` rendered `2`. The fragment's answer is now checked against the receiver's own container, and a mismatch is E0201 where the answer is written:

> `Expected Option(?) but got Int` — at `$1 + 1` in `o.flat-map($1 + 1)` over an `Option(Int)`
>
> `Expected Option(?) but got {n: Int}` — at `{n: $1}` in `o.flat-map({n: $1})`
>
> `Expected Result(?, Text) but got Int` — at `$1 + 1` in `r.flat-map($1 + 1)` over a `Result(Int, Text)`

Over a `Result(T, E)` the answer's error has to be an `E`, so `r.flat-map(Err($1))` there is `Expected Text but got Int` at the `$1`, and a `fn` answering a `Result(Int, Int)` is `Expected Result(?, Text) but got Result(Int, Int)` at its name. A `fn` named as the fragment is checked as its call, and an `if` or a `match` at what each branch answers. `Some(…)`, `None`, `Ok(…)`, `Err(…)` of the receiver's error type, and a `fn` whose `->` is one of those, all still check.

A `filter` predicate is held to `Bool` the same way, over a `List`, an `Option`, a `Map` and a `Set` alike. `xs.filter($1 + 1)` on a `List(Int)` passed `check` and kept every element whose sum was not `0`. It is now `Expected Bool but got Int` at the predicate.

An answer whose type the checker cannot decide, such as a `fn` with no `->` whose body's type is not decided, is still checked against nothing. The result of a `flat-map` call is not typed yet either, so the call still passes into a slot of any type.
