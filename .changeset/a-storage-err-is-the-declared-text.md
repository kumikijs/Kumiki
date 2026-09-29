---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

A failed storage / session / indexed effect now delivers the `Text` its `out=Result(T, Text)` declares to `.err`, and `$e` there is typed as that `Text` (#504).

The spec declares these effects' failure as `Text`, but the handlers delivered a `{message: …}` record. A reducer written to the declaration, `problem := $e`, rendered `[object Object]`; one written to the runtime, `$e.message`, contradicted the declared type, so `$e` had to stay unchecked.

The handlers in `effects-storage.ts` and `effects-indexed.ts` now deliver the failure's message itself (`"Error: storage blocked"`, `"app.indexed-db is not declared"`). A throw from such an effect's `map-request`, or from a host provider registered for its capability, is delivered as the same `Text`: codegen catches it inside the invoke, because the dispatcher's own catch cannot know `E`. `.err($e, _)` on one of these effects binds `$e` to the `E` of `out=`, so `$e.message` is E0108 and `n := $e` into an `Int` slot is E0201.

A program that read `$e.message` on one of these effects must read `$e`. A host provider for `storage.*` / `session.*` / `indexed.*` should return its failure as a `Text` too. HTTP effects are unchanged: they still deliver the `HttpError` record, and `.err` on HTTP and custom capabilities stays unchecked.
