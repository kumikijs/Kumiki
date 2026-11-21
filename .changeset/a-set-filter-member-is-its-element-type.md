---
"@kumikijs/compiler": minor
---

Type `$1` in a `Set`'s `filter` as the member, of the Set's element type

`Set(T).filter` hands its predicate each member as an `[element, true]` entry, and the lowering takes the element out of it, but the checker gave the fragment no binding on a `Set`. `$1` had no type, so nothing was checked against it:

```kumiki
slot s : Set(Int) = [10, 20]
slot k : Set(Int) = []
fn loud(x: Text) -> Bool = x != ""
reducer go on=ui.click(Go)
    do= k := s.filter(loud)
tile Go = button(text="go")
```

```
$ kumiki check a.kumiki
ok
```

`s.filter(loud($1))` and `s.filter($1.size > 0)` passed too, where over a `List(Int)` the first is E0201 and the second E0108.

`$1` is now the member, of type `T`, as the table of positionals in language.md lists it. `s.filter(loud)` and `s.filter(loud($1))` are **E0201** `Expected Text but got Int`, and `s.filter($1.size > 0)` is **E0108**. The member is `$1` whole: a `Tuple(A, B)` member is not taken apart, as a `Map`'s key is not. A member that does not read back as its type, such as a `Bytes` one, stays untyped, as such a Map key does.

The fragment binds no `$2`. It used to read the entry's `true`; it is now **E0103** (`"$2" is not bound here — a Set's .filter hands each member whole, as "$1"`), as on a `List`'s `filter`. A `fn` named there with two parameters is still **E0213**, and its message now ends the same way.

What a Set's `filter` keeps at runtime is unchanged, a Set a host hands over as an array included.
