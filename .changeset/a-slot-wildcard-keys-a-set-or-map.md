---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A `<slots.X>` member of a Set literal or key of a Map literal in a reducer-test `expect` stands for the slot's value

`expect = {slots: {tags: [<slots.pick>]}}` never matched: the member was keyed by the wildcard's own string form, not by the value of `pick`, so the test failed even when the reducer had added exactly that value. A `<slots.X>` map key (`{<slots.pick>: 1}`) failed the same way. As a record field value or an effect argument, `<slots.X>` already stood for the slot's post-execution value.

Now the matcher keys each such member or entry by slot `X`'s post-execution value, the way `add` / `insert` key that value, and matches it as if the value had been written in its place (testing.md). A value the actual Set or Map does not hold still fails the test, and so does one that is already among the literal's other members or keys: when `pick` holds `"z"`, `["z", <slots.pick>]` names two members under one key and fails rather than matching a one-member Set. Each `<slots.X>` takes its key before any `<any-id>` pairs with what is left.

A wildcard nested inside a structured Set member or map key (`[{id: <slots.pick>}]`) could never match, since the member is keyed by its whole value; `check` now reports it as E0109 instead of leaving the test to fail.
