---
"@kumikijs/compiler": patch
---

`error(field=…)` takes an index whose key is computed, such as `rows[i].email`, and reads the key again on every render

A path in `field=` named an element only by a literal key, so
`error(field=rows[i].email)` was E0230, and a page that edits one row at a
time, or each entry of a `Map` in a `for` over its keys, had no way to put
that row's message beside it. An index's key is now any expression of the
index's type, as it is in `bind=rows[i].title`. The tile renders the failure
of the element the key names when it renders, so it follows `i` when `i`
changes, and `for k in book.keys error(field=book[k].email)` shows each
entry's own message. A key that is no `Int` for a `List`, or not the key
type for a `Map`, is E0201, as it is in the read `rows[i]`.
