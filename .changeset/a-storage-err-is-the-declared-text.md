---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

A failed storage / session / indexed effect now delivers the `Text` its `out=Result(T, Text)` declares to `.err`, `$e` there is typed `Text`, and declaring any other `E` on these effects is the new E0306 `err-type-not-text` (#504).

The spec declares these effects' failure as `Text`, but the handlers delivered a `{message: …}` record. A reducer written to the declaration, `problem := $e`, rendered `[object Object]`; one written to the runtime, `$e.message`, contradicted the declared type, so `$e` had to stay unchecked.

The handlers in `effects-storage.ts` and `effects-indexed.ts` now deliver the failure's message itself (`"Error: storage blocked"`, `"app.indexed-db is not declared"`), and read the storage global and the request inside their own `try`, so a `SecurityError` from the `localStorage` getter or a missing request is that `Text` too. Codegen runs everything in such an effect's invoke inside a `try` — the `map-request`, the host provider and the built-in handler, awaited — and reads every err value, returned or thrown, through one normalizer: a `Text` is itself, an `Error` is `Name: message`, a record with a `Text` `message` is that `message`, anything else is its JSON text. A throw caught there is marked `final`, so `retry=` makes one attempt for it, as it did when the throw reached the dispatcher.

`.err($e, _)` on one of these effects binds `$e : Text`, so `$e.message` is E0108 and `n := $e` into an `Int` slot is E0201. A program that read `$e.message` must read `$e`, and one that declared `out=Result(T, {message: Text})` must declare `Result(T, Text)`. A host provider for `storage.*` / `session.*` / `indexed.*` should return its failure as a `Text`. HTTP effects are unchanged: they still deliver the `HttpError` record, and `.err` on HTTP and custom capabilities stays unchecked.
