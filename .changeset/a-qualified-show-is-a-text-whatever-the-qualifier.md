---
"@kumikijs/compiler": patch
---

Infer `Text` for `T.show(v)` on every qualifier, `Duration` and `Bytes` included

`T.show(v)` is the qualified spelling of `v.show`. Codegen lowers it with one
regex and one helper — `_s.show(v)`, the qualifier discarded — so it is a `Text`
for every capitalised `T`. The checker did not agree for two of them:

```
slot ms    : Int  = 1500
slot shown : Text = ""
reducer go on=ui.click(B) do= shown := Duration.show(ms)

E0201 type-mismatch at 3:40: Expected Text but got Duration
```

`Int.show`, `Time.show`, `Url.show` and a user type's `.show` were all accepted
into that slot. `Duration.show` and `Bytes.show` were not, which is the
expensive direction of a wrong diagnostic: the program runs, and the author has
nothing to write instead — `ms.show` is the method, a different expression, not
a repair for this one.

`inferType`'s `Call` case answered `Duration.*` with `Duration` and `Bytes.*`
with `Bytes` before it looked at the member at all, so the two qualifiers that
also name constructors returned the constructor's type for a call that
constructs nothing. It now reads the member first, the way the lowering does.

`fresh` and `parse` are unchanged and stay answered by the qualifier. For
`fresh` that is correct — its result is the qualifier's own type. For `parse` it
is not: the spec gives it `Option(T)` of the qualifier, and the branch returns a
bare `T`, so an `Option(Duration)` slot refuses `Duration.parse(t)` while a
`Duration` slot accepts it. That is a separate defect, filed as #424 and
untouched here.

The spec said `TypeName.show(value) : Text` throughout (stdlib §2.4.3), so this
is the implementation moving to it, not a language change.

One shape does stop checking, and it is this same reordering seen from the other
side. A `Duration` or `Bytes` slot used to accept a `show` call, because the
call was read as a constructor:

```
slot n : Int = 1
slot d : Duration = Duration.ms(0)
reducer r on=ui.click(B) do= d := Duration.show(n)
```

That was `ok` and is now `E0201 type-mismatch: Expected Duration but got Text`.
The value is a string at runtime, so the slot never held what it was declared to
hold — the program was already wrong and is now told so. Repair it by dropping
the `show`, or by declaring the slot `Text` if the string was what was wanted.
