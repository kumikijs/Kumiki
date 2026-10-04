---
"@kumikijs/compiler": patch
---

`refs` and `rename` read a test body section by section, as the checker does

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

The section names were also matched at any depth, and the `for-all` names were
not bound in a `given`:

- A key spelled `mocks` was read as a mocks section wherever it stood: a slot
  named `mocks`, a `mocks` field in a slot's value, a `mocks` key in an
  `expect`. With `slots: {mocks: {save: ok(1)}}`, `save` became an effect
  with no position, so the test was listed under `refs effect.save` and
  `rename effect.save` was refused, though the test names no effect; and
  `ok(1)`, a call to the `fn ok`, was taken for the mock's `ok`, so
  `rename fn.ok yes` was rolled back on an E0116.
- A field named `target` was read as a tile wherever it stood, so with a tile
  `Home` and a variant `Home`, the variant in `slots: {nav: {target: Home}}`
  was the tile, and `rename tile.Home Start` rewrote it and was rolled back on
  an E0216. The `ui` of an event's `type: ui.click` was read as the slot `ui`,
  at a position `rename slot.ui` rewrites.
- An episode-test's `slots-equal` keys were not read as slots, so `refs
  slot.seen` left out the test and `rename slot.seen viewed` was rolled back
  on an E0103 instead of refused.
- A `for-all` name read in a `given` was the `fn` or slot of the same name, so
  `rename fn.size length` rewrote the generated value and was rolled back.

The walk now reads each kind's own sections, at the top of its `given` and
`expect`, through the same table the checker reads them by, and each position
as testing.md §8.1.1 says the checker resolves it. An `expect.effects` entry,
written as a call or as a bare name, is the effect, at its callee. A call in a
value is the `fn` it calls. A `given.slots`, `expect.slots` or `slots-equal`
key names a slot, and a `mocks` key an effect; a mock's `ok(…)` / `err(…)` /
`delay(…)` / `from-log` / `ignore` stay the mock's own vocabulary even when a
`fn` or slot shares the name, so only their payloads and delays are walked. An
event's `type` names no definition, and its `target` is a tile only on a `ui.*`
event. `<slots.X>` is the slot, at `X`. The `for-all` names are bound
throughout the test. A key that names no section of the test's kind, which
the checker reports as E0714, is not read at all.

The first three renames now exit 0 with a file that checks, and the test still
passes. `rename` rewrites a name the test wrote as an identifier: a call, an
`expect.effects` entry, a `<slots.X>`, an event `target`. A name written as a
record key — a `slots` / `slots-equal` key, a `mocks` key — has no position of
its own, and `rename` refuses it. The `<slots.X>` wildcard node carries the new
`slotPos` for that position.
