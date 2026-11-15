---
"@kumikijs/compiler": patch
---

A long chain of aliases or generics that each add `where`s to the one below compiles instead of overflowing the stack, and a chain of aliases checks in linear time

```
type T0 = Int where between(0, 1000) where between(-1000, 1000) # ... 250 `where`s
type T1 = T0 where between(-1000, 1000) # ... 250 `where`s
# ... each Tn adds 250 `where`s to T(n-1) ...
type T39 = T38 where between(-1000, 1000) # ... 250 `where`s

type G0(T) = T where between(0, 1000)
type G1(T) = G0(T) where between(0, 1000)
# ... each Gn applies G(n-1) ...
type G3999(T) = G3998(T) where between(0, 1000)

slot x : T39 = 7
slot y : G3999(Int) = 7
```
