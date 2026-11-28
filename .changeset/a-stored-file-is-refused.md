---
"@kumikijs/runtime": patch
---

`storage.write` and `session.write` answer `err` for a value that holds a picked `File`, naming the key and the first `File` in it, and store nothing, instead of answering `ok` and keeping only the file's name, size and type.

A `File` is its name, size and type beside the runtime's handle on the picked
file, which JSON writes as `{}`. A write stored that, and a read handed back a
`File` that held no file: `file-url` of it was `""`, and a `FileV` part holding
it failed its request with `HttpError{status: 0}`. Nothing told the program.
The write now answers, on `.err`:

> `storage.write: the value for "f" holds the File "a.txt", and localStorage would keep only its name, size and type, not the file; nothing was stored`

wherever the `File` sits in the value (a record field, a `List`, an `Option`,
a `Map`). An entry already under the key is left as it was. A `File` that holds
no file, as one decoded from JSON does, has nothing to lose and is still stored
as its JSON, `_file: {}` included. The refusal is the built-in handler's: a host
provider for the capability still receives the request as built. `indexed.write`
does not refuse a picked `File`, because the structured clone it puts keeps the
file. Example 273 (`packages/examples/features/273-stored-file-refused.kumiki`)
shows the `.err` reducer that receives the message.
