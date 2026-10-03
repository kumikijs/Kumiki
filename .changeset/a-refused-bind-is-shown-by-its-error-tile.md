---
"@kumikijs/runtime": patch
"@kumikijs/compiler": minor
---

Show why a bound field was refused, and report the `strict` prop nothing implemented

A `bind` whose value the slot's refinement refuses leaves the slot on the last
value it accepted, and the control keeps what was typed. `error(field=…)` used
to judge the slot, which still held the old, valid value — so the field showed
`ada@examplecom`, the slot held `ada@example.com`, and the page said nothing.
The error tile now judges what the field shows: while a control shows a value
its refinement refused, that value's message is rendered, across unrelated
reducers too, until the field is edited to a value the slot takes or a reducer
rewrites the slot and the field follows.
With one app mounted into several hosts, each view's error tile speaks only
for its own view's field, and during an IME composition the message is settled
when the composition ends rather than for every intermediate value.

`strict=false`, which forms.md §5.1.2 used to describe as a second mode, was
never implemented and its `valid` flag had no reader. The section now has one
mode, and `strict` on any bind control kind (`input`, `textarea`, `select`,
`slider`, `check`, `switch`, `radio`, `editable`), bound or not, is **E0219**:

> `"strict" is not a prop of input: a value its refinement refuses is always refused, and error(field=…) shows why (see docs/spec/forms.md §5.1.2)`
