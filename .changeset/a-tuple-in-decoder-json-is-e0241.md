---
"@kumikijs/compiler": patch
---

A tuple written as the type of `Decoder.Json(T)` is now **E0241 `tuple-as-type`**, which says to write `Tuple(A, B)`, where `check` used to report each of its types as an undefined variant.

```
effect loadPinned cap=storage.read
                  in=Unit
                  out=Result(Option(Tuple(Note, Int)), Text)
                  map-request={key: "pinned", decode: Decoder.Json((Note, Int))}
# before: E0116 at `Note`: Reference to undefined variant "Note" — did you mean "None"?
#         E0116 at `Int`:  Reference to undefined variant "Int"
# after:  E0241 at the `(`: The tuple `(Note, Int)` is a value, and Decoder.Json decodes by a type:
#         write the tuple type as `Tuple(Note, Int)`
```

`(a, b)` is how a tuple value is written; the type is `Tuple(A, B)`, in `Decoder.Json` as in any declaration. The tuple's items are read as types, so a misspelt one is E0117 at its name, and `refs` and `rename` see them. A tuple with a value among its items still decodes as plain JSON, as any value does. `Decoder.Json(Tuple(Note, Int))` checks as before.
