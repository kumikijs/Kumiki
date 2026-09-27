---
"@kumikijs/runtime": patch
---

`<T>.fresh()` returns a uuid outside a secure context too

`crypto.randomUUID` exists only in a secure context. On a page served over plain
http the runtime fell back to a base-36 string that is not a uuid, so once the
`uuid` refinement gates a keyed slot, every write of a fresh id was rejected.
The fallback now builds a v4 uuid from `crypto.getRandomValues`.
If `getRandomValues` is missing as well, the bytes come from `Math.random`,
which is not cryptographically random; a fresh id only has to be distinct, never
unguessable.

**Replaying an old recording:** an episode journal or scenario recorded before
this change holds the base-36 ids `fresh()` returned then, and replaying it into
a slot whose ids are `uuid`-gated now refuses those writes — reported, not
silent. Re-record it, or replace the ids with uuids.
