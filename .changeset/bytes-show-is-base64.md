---
"@kumikijs/runtime": patch
---

`Bytes.show` is the bytes' base64, which `Bytes.from-base64` reads back

`.show` on a `Bytes` fell through to JavaScript's `String`, which writes a
`Uint8Array` as its decimal byte values joined with commas:
`Bytes.from-text("hi").show` was `"104,105"`. Nothing reads that text back.
`Bytes.parse` reads its text as UTF-8, so `Bytes.parse(b.show)` was the seven
bytes of `"104,105"`, and no constructor turns the comma list into bytes again.

`show` now renders a `Uint8Array` as padded standard base64, the text
`Bytes.from-base64` decodes: `Bytes.from-text("hi").show` is `"aGk="`,
`Bytes.from-bytes([255, 0, 128]).show` is `"/wCA"`, and an empty `Bytes` is
`""`, as before. So `Bytes.from-base64(b.show) == b` for every `Bytes`,
including bytes that are not UTF-8. `+` with a `Text` side, `fmt`, `Bytes.show(b)`
and a tile's text all render through `show`, so they all change with it. A
`Bytes` inside a `List` or a record is rendered by the container, which does not
call `show` on its elements, so `[b].show` is unchanged.

`Bytes.parse` still reads UTF-8, so it is not `show`'s inverse. stdlib.md
§2.2.10 and §2.4.3 say so and name `Bytes.from-base64` as the inverse.

**Migration.** A program that showed a `Bytes` and relied on the comma-joined
decimal text gets base64 instead. To keep a list of byte values, keep the
`List(Int)` the bytes were built from. To turn shown text back into bytes, use
`Bytes.from-base64(t)` rather than `Bytes.parse(t)`.
