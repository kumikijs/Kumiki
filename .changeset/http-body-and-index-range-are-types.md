---
"@kumikijs/compiler": patch
---

`HttpBody(T)` and `IndexRange(K)` are standard-library types, so an effect declared with `body: HttpBody(T)` or `range: Option(IndexRange(K))`, as http.md declares `http-post` and `indexed-query`, now checks.

Neither name was a type, so the spec's own declarations failed `check`:

```
effect indexed-query cap=indexed.read in={store: Text, index: Option(Text), range: Option(IndexRange)} out=Result(List(JsonValue), Text)
E0117 undef-type: Reference to undefined type "IndexRange"
E0117 undef-type: Reference to undefined type "JsonValue"
```

`HttpBody(T)` is `Json(T) | Form(Map(Text, Text)) | Multipart(Map(Text, FormValue)) | Text(Text) | Bytes(Bytes) | Empty`,
generic in what `Json` carries. A field declared `HttpBody(T)` takes those six
variants and nothing else: a bare record there is E0202 in an emit's argument
(E0201 elsewhere), and `Json(record)` is how one is sent. A `map-request`'s
`body` is still not checked for its type, so one that is no variant is still
sent as JSON.

`IndexRange(K)` is `{lower: Option(K), upper: Option(K), lowerOpen: Bool, upperOpen: Bool}`,
the fields the IndexedDB handler already read. `JsonValue` named no type and
is gone from the spec: `indexed-query` answers `Result(List(T), Text)`, `T`
being the record type the program stores.

Upgrade note: both names are reserved, like `FormValue`, because the runtime
reads their values: a program's own `type HttpBody` or `type IndexRange` is
E0231, and the name keeps the standard library's type. Each is generic, so
writing it with no argument is E0210. The examples and the benchmark corpus
produce no new diagnostic.
