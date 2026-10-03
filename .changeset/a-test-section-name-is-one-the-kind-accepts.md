---
"@kumikijs/compiler": minor
---

Report a test-body section name the test kind does not have

A test body's sections are read by name — `slots`, `event`, `mocks`, `panic`,
`slots-equal` — and a name outside that set was read by nothing and reported by
nothing. The section simply did not happen, which does not weaken the test, it
replaces it:

```kumiki
test typo-section =
    reducer-test inc
        given  = {slot: {count: 41}, event: {type: ui.click, target: B}}
        expect = {slots: {count: 1}, effects: []}
```

```
check: ok
kumiki test: PASS  typo-section (1ms)
```

`slot` instead of `slots`, so the 41 never happens: `count` starts at its
declared `0`, `inc` makes it `1`, and the assertion holds against a state the
author did not choose.

That is E0714 now, at the key's own position, with the accepted set named and
the nearest of them offered when one is close enough:

```
E0714 test-section-unknown at 9:19: Unknown section "slot" in a reducer-test
`given` — did you mean "slots"? (accepted: slots, event, mocks)
```

A name that belongs to the test's *other* clause is reported as that rather
than as a misspelling — `effects` written in a `given` is spelled right and
placed wrong, which no distance rule can say. Two equally close names offer
nothing, because the accepted set is already in the message.

The accepted set is one table per kind and clause (`src/test-sections.ts`), and
both halves of the compiler now read sections through it: `emit-test.ts` names
one with a type derived from the table, and the checker dispatches on a name
the table gives it, so a section either side knows about and the other does not
fails to compile.

**The camelCase spellings go.** `episodeExpectJs` also read `slotsEqual` /
`noPanics` / `noErrors`, which the spec never documented and no Kumiki source
in this repo writes. A vocabulary only a code comment knows about is the shape
this change exists to remove, and an alias also let one section be written
twice (`{no-panics: true, noPanics: false}`) with the second silently winning.
They are E0714 now; write the hyphenated names §8.1.1 has always specified.

An `episode-test` `expect` section codegen does not recognise now throws rather
than lowering to `{}`, which is what the runtime reports as a passing test that
asserted nothing — the same rule `expect.effects` and an episode mock already
follow for a caller that skips `check`.
