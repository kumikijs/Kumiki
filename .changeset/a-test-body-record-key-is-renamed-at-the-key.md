---
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

`rename` rewrites a slot or effect a test body writes as a record key

A test body's record keys — the slots of a `given.slots`, an `expect.slots`
and an episode-test's `expect.slots-equal`, and the effects of a `mocks` — were
references with no position, so `refs` listed the test at its first line and
`rename` refused the name:

```kumiki fragment
test replay-adds =
    episode-test
        load   = "add.jsonl"
        mocks  = {persist: ignore}
        expect = {slots-equal: {items: ["Buy!"]}, no-panics: true}
```

Before, `kumiki rename <file> slot.items todos` stopped with "Cannot rename
slot.items: it is named in a position with no rewritable identifier
(test.replay-adds)", and `rename effect.persist save` did the same. A key is a
token of its own, and the parser records the field at it, so each key is now a
reference at the key: `refs` lists the test at the key's line, and `rename`
rewrites the key with the rest of the program, to `slots-equal: {todos: …}` and
`mocks = {save: ignore}`.

One form is still refused: a key written as its own value, `{items}`, when the
value is not that same slot. With `for-all = {items: List(Text)}`,
`given = {slots: {items}, …}` seeds the slot with the generated value; the one
token rewritten for the slot would seed the slot with itself instead, in a file
that still checks. `rename slot.items` refuses such a test, as it did before,
and so does `rename` of an effect whose `mocks` key is written `{ignore}`,
where the value is the mock's script. A `{count}` whose value is the slot
itself is renamed whole.
