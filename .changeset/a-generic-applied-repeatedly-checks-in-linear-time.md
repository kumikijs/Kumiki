---
"@kumikijs/compiler": patch
---

A chain of generics that hand their parameter back and each apply the one below several times checks in linear time

```
type D0(T) = T
type D1(T) = D0(D0(D0(T)))
# ... each Dn(T) = D(n-1)(D(n-1)(D(n-1)(T))) ...
type D14(T) = D13(D13(D13(T)))

slot a : D14(Text) = "ku"
```

Before, `kumiki check` on this took time growing as 3^k in the depth of the
chain: about 0.4 s at 11 levels and 12 s at 14.
The check for a refinement an application's arguments put over a base it
cannot test walked every application in a body with its arguments
substituted, so `D14`'s three `D13`s each walked `D13`'s three `D12`s, down to
`D0`. With a refinement at the bottom (`type D0(T) = T where nonempty`), an
application over the wrong base was also reported once per path: `D1(Int)`
gave three identical E0804s, `D10(Int)` 59,049, and `D12(Int)` overflowed the
stack.

After, the same program checks in milliseconds, and so does a forty-level
chain. Each argument is first taken through the generics at its head that
hand a parameter straight back, as normalisation already takes them, so the
three `D13`s are applied to the same argument and walked once. A refinement
is reported once for each base it is put over, however many paths reach it,
so `D1(Int)` gets one E0804; two refinements are still two. The messages
themselves are unchanged.

A chain whose generics hand nothing back (`type D0(T) = {v: T}`) has no
argument to share, and its walk is still 3^k, as before; it is no slower
than it was.
