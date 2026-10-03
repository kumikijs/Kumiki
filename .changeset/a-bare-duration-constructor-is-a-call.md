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

`Duration` and `Bytes` now read the way `Decoder` and `EffectId` already did, so
every namespace with built-in constructors answers a bare member by count and by
name, in the same words as its parenthesised form:

> `Function "Duration.s" expects 1 argument(s) but got 0` — **E0213**
>
> `Call to undefined function "Duration.nope"` — **E0116**

Leaving the two out was never a guard, only that field read. The reason for it
was that reading them as calls traded one silence for another — a missing
argument was defaulted to `0` — and that reason is gone, because the count is
checked and the default throws.

`Decoder.Json` is the same rule from the other side and is unchanged: a member
with an argument in an otherwise constant namespace, so it is the one `Decoder`
member with no paren-less spelling.

Two consequences worth knowing before upgrading:

- **`Duration.fresh()` and `Bytes.fresh()` are now E0116**, and so is a
  zero-argument `Duration.parse()` — including the parenthesised spellings,
  which previously passed. `fresh` / `parse` / `show` are lowered on any
  capitalised qualifier and ignore the one they are written on, so
  `Duration.fresh()` minted a UUID straight into a `Duration` slot with nothing
  reported. Inside these four namespaces those three members now resolve to
  nothing, which is the rule `Decoder` and `EffectId` already carried; it is
  documented under E0117.
- A program that declares its own `type Duration` is unaffected. Only the
  `Duration.<member>` position is claimed — tags written as bare names, values
  read through a receiver, and `Duration` matched as a pattern all still work.
