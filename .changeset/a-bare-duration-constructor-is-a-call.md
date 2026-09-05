---
"@kumikijs/compiler": minor
---

Read a bare `Duration` / `Bytes` constructor as the call it is

`Duration.s` written without parentheses was not a call at all. It was a field
read on a freshly built variant — `{_tag: "Duration"}["s"]` — so it evaluated to
`undefined`, and nothing objected:

```
$ kumiki check a.kumiki
ok
```

A `setTimeout(undefined)` is a `setTimeout(0)`, so a timer written with that
duration fires immediately and forever. That is the same failure the argument
count was added for — `Duration.s()` lowered to `((0) * 1000)` — reached by the
one spelling that never went through the count.

`CONSTANT_NAMESPACES`, the set the parser reads a qualified member by without
parentheses, now names every qualifier codegen lowers: `Duration` and `Bytes`
join `Decoder` and `EffectId`. Leaving them out was never a guard, only that
field read. The reason they were left out was that reading them as calls traded
one silence for another — a missing argument was defaulted to `0` — and that
reason is gone, because the count is checked and the default throws.

So a bare member is now answered by count and by name, in the same words as its
parenthesised form:

> `Function "Duration.s" expects 1 argument(s) but got 0` — **E0213**
>
> `Call to undefined function "Duration.nope"` — **E0116**

`Decoder.Json` is the same rule from the other side and is unchanged: it is a
member with an argument in an otherwise constant namespace, so it is the one
`Decoder` member with no paren-less spelling.

The set is applied by spelling, without consulting the type table, so it claims
the `Duration.<member>` position everywhere — but only that position. A program
that declares its own `type Duration = Short | Long` writes its tags as bare
names and reads its values through a lowercase receiver, neither of which is
that position, and both still check.
