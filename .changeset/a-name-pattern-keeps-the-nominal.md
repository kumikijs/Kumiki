---
"@kumikijs/compiler": patch
---

A name pattern in a `match`, and each name inside a tuple pattern, now binds the
type as written, `nominal` included.

```
type PostId = nominal Text where uuid
type UserId = nominal Text where uuid
slot p  : PostId                = "a"
slot u  : UserId                = "b"
slot tt : Tuple(UserId, PostId) = ("b", "a")

p := match u with | x -> x              # was ok; now E0201 Expected PostId but got UserId
p := match tt with | (a, b) -> a        # was ok; now E0201
match u with | x -> p := x              # was ok; now E0201
```

The binder's nominal reaches every reader of it, not only a declared
destination: `let v = match u with | x -> x; p := v` now reports the same
`E0201`, and an `==` between the binder and another nominal now reports
`E0201 Operator "==" cannot compare UserId with PostId`, as `u == p` does.

Only a variant pattern's payload kept its nominal before: a bare name bound the
scrutinee's base type (`Text`), which goes into any nominal over `Text`, so the
`UserId`-into-`PostId` mistake that `nominal` exists to catch passed `check`.
language.md §1.9 already says each arm is read with the types its pattern binds;
the checker now does. Binds that fit (`u := match u with | x -> x`,
`x.length` on the binder) are unaffected.
