---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

Make a decoded value that `Decoder.Json(T)`'s `T` refuses the effect's `.err`

`Decoder.Json(T)` lowered to a bare `"json"` sentinel, so nothing checked the
decoded value against `T`. A restore of data the type refuses (a base-36 id
from an older `fresh()` under `TodoId = nominal Text where uuid`, an empty
`text` on `Text where nonempty`) answered `.ok`, the reducer's writes were
refused as a batch (runtime.md §10.3.3), and `02-todomvc`, which sets `ready`
in that reducer, stayed on its boot screen with nothing able to clear it.

Now `Decoder.Json(T)` for a `T` that carries a predicate anywhere in it lowers
to the walk a slot of type `T` is gated by, and the storage, session,
IndexedDB and HTTP read handlers run it on what they decoded (http.md §6.1.4,
§6.7.2). A refused value is `.err`: from storage, session or IndexedDB the
`Text` its `out=` declares, such as `decode failed: uuid at .keys["k3j9x"]`,
and from HTTP an `HttpError` with the
response's status and text, which is not retried. A `T` with no predicate lowers to the
sentinel as before. The check ships in a new `effects-decode` runtime module,
only with the handlers that import it, so an app that decodes nothing (the
counter) is unchanged.

A host provider for a read capability receives the check as `decode` on the
request. A scenario's scripted `.ok` stands for a value already decoded and is
not checked.

`apps/03-blog` decoded its stored session with `Decoder.Json(Option(Session))`,
though a storage read already answers `Option` of what it decodes (http.md
§6.7.2). The check now reads that `T` literally, so the example decodes
`Session`.
