---
"@kumikijs/compiler": patch
---

`refs` and `rename` read a test body's effects, calls and slot wildcards as references

Three of the names a test body writes were not walked as what they are, so
`refs` missed them and `rename` refused or was rolled back:

```kumiki fragment
test add-shouts-and-persists =
    reducer-test addItem
        given  = {slots: {draft: shout("Buy")}, event: {type: ui.submit, target: AddForm}}
        expect = {slots: {draft: ""}, effects: [persist(<slots.items>)]}
```

- An `expect.effects` entry was recorded as an effect with no position, so
  `kumiki rename <file> effect.persist save` stopped with "it is named in a
  position with no rewritable identifier".
- Every call in a `given` / `expect` / `mocks` value was looked up as an
  effect, so a `fn` called there (`shout("Buy")`) was not a reference at all.
  `refs fn.shout` left out the test, and `rename fn.shout yell` was rolled
  back on the E0116 its untouched call then raised.
- `<slots.items>` was not walked, so `refs slot.items` left out the test and
  `rename slot.items todos` was rolled back on an E0103.

Each position is now resolved as testing.md §8.1.1 says the checker resolves
it. An `expect.effects` entry, written as a call or as a bare name, is the
effect, at its callee. A call in any other value is the `fn` it calls. A
`mocks` key names an effect, and a mock's `ok(…)` / `err(…)` / `delay(…)` /
`from-log` / `ignore` stay the mock's own vocabulary even when a `fn` or slot
shares the name, so only their payloads and delays are walked. `<slots.X>` is
the slot, at `X`. All three renames above now exit 0 with a file that checks,
and the test still passes. The `<slots.X>` wildcard node carries the new
`slotPos` for that position.
