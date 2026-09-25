---
"@kumikijs/runtime": patch
---

`<T>.fresh()` returns a uuid outside a secure context too

`crypto.randomUUID` exists only in a secure context. On a page served over plain
http the runtime fell back to a base-36 string that is not a uuid, so once the
`uuid` refinement gates a keyed slot, every write of a fresh id was rejected.
The fallback now builds a v4 uuid from `crypto.getRandomValues`.
