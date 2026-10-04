---
"@kumikijs/compiler": patch
---

A chain of generics that each apply the one below several times checks in linear time

```
type D0(T) = T
type D1(T) = D0(D0(D0(T)))
# ... each Dn(T) = D(n-1)(D(n-1)(D(n-1)(T))) ...
type D14(T) = D13(D13(D13(T)))

slot a : D14(Text) = "ku"
```

Before, `kumiki check` on this took time growing as 3^k in the depth of the
chain: about 0.4 s at 11 levels, 12 s at 14, and minutes a few levels further.
The check for a refinement an application's arguments put over a base it
cannot test walked every application in a body with its arguments
substituted, so `D14`'s three `D13`s each walked `D13`'s three `D12`s, down to
`D0`. With a refinement at the bottom (`type D0(T) = T where nonempty`), an
application over the wrong base was also reported once per path: `D1(Int)`
gave three identical E0804s, `D12(Int)` half a million.

After, the same program checks in milliseconds. Each argument is first taken
through the generics at its head that hand a parameter straight back, as
normalisation already takes them, so the three `D13`s meet as one application
and it is walked once. Each E0804 message is reported once at the
application; the messages themselves, and which applications get one, are
unchanged.
