---
"@kumikijs/runtime": patch
---

Mint `<T>.fresh()` ids as UUIDv7, in the order they were minted

stdlib.md §2.4.1 says `TypeName.fresh()` is a UUIDv7, and the runtime handed
out a v4: `crypto.randomUUID()` where the platform had it, and otherwise a v4
built from `getRandomValues` or `Math.random`. A v4 is random through and
through, so ids sorted in no particular order:

```
ids := ids.push(ItemId.fresh())   # twelve times in one reducer run
ids.sort == ids                   # false
```

A v7 starts with the millisecond it was minted in, so `ids.sort == ids` is
`true`. The runtime now builds every id itself — a 48-bit Unix-millisecond
timestamp, the version `7`, a 12-bit counter, the variant `10`, and 62 random
bits from `getRandomValues` (or `Math.random` where that is missing) — and no
longer asks `crypto.randomUUID`, since what it returns is a v4.

The ids one running app mints sort, as `Text`, in the order they were minted,
also when several are minted in one millisecond and after the clock steps
back: the counter counts up within a millisecond, and an id never carries a
time earlier than the one before it. Nothing orders ids minted in two tabs, on
two devices, or across a reload beyond the clocks they read.

Every id still passes the `uuid` refinement, and an episode still records the
whole id under `fresh-id`, so a replay hands back the recorded id rather than
minting another.
