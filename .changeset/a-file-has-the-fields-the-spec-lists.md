---
"@kumikijs/compiler": patch
---

`File`'s spec row lists only the fields a program can read (`name`, `size`, `type`), and `f.constructor` or any other name every JavaScript object has is E0108 instead of a type mismatch

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
field table. Reading the fields from that table also fixes the names every
JavaScript object answers. `f.constructor`, `f.toString`, `f.valueOf` and
`f.hasOwnProperty` were each taken for a field and reported as a mismatch
against the JavaScript function they printed, such as
`function Object() { [native code] }`. Each is E0108 now, like any other name
`File` does not have.
