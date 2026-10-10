---
"@kumikijs/compiler": patch
---

Give `File` the fields its spec row lists, and only those

The standard library's `File` row (stdlib.md §2.1.3) promised a fourth field,
`content: Bytes`, that nothing implemented: `f.content` was E0108, and the
record a file input hands a reducer carries `name`, `size` and `type` only. A
program written to the row could not be checked.

The row now lists what a program can read — `{name: Text, size: Int, type: Text}`
— and says where a file's bytes go instead. A browser reads them only
asynchronously, so the record the `change` event delivers cannot hold them;
they reach a server as a `FileV` part of a `Multipart` body (http.md §6.1.3).
`f.content` stays E0108:

> `Type "File" has no member ".content"` — **E0108**

The checker and the generated TypeScript declaration of a `File` now read one
field table, and a test compares it, and the runtime's file record, with the
spec row on both tracks. Reading the fields from that table also fixes a name
every JavaScript object answers. `f.constructor` was taken for a field and
reported as a mismatch against a type it printed as
`function Object() { [native code] }`. It is E0108 now, like any other name
`File` does not have.
