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

`fresh` and `parse` are unchanged and stay answered by the qualifier: their
result *is* the qualifier's type, so there the qualifier is the whole question.

The spec said `TypeName.show(value) : Text` throughout (stdlib §2.4.3), so this
is the implementation moving to it, not a language change. Nothing that checked
before stops checking: `Duration.show(v)` in a non-`Text` position was already
rejected, and is still rejected — now naming `Text`.
