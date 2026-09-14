---
"@kumikijs/compiler": minor
---

Refuse a `tile-test` whose `given.in` disagrees with its target

A `tile-test` applies its target: the lowering calls
`App._tilesById["<T>"](<given.in>)`. Nothing checked that the argument matched
the target's declaration, so a test that omitted the `in` its tile declares
passed `undefined`:

```kumiki
tile Card in={label: Text} = text($1.label)

test t =
    tile-test Card
        given  = {slots: {count: 0}}
        expect = text("x")
```

`check` said ok, and `kumiki test` died with

```
TypeError: Cannot read properties of undefined (reading 'label')
```

— no test name, no position, no code, reported by the runner's `catch` as "the
test runner threw". A plain `in=Text` was quieter and no better: `$1` rendered
as `undefined` and the snapshot compared against it. The mirror case — an `in`
given to a target that declares none — was dropped, so the test asserted a
render that never saw the value it was written for.

Both are E0213 now, with the sentence the tile-call form already gives, because
a `tile-test` is one such call: `Tile "Card" expects 1 argument(s) but got 0`.
An `in` the target does not declare is reported at the section, which is the
text to delete; a missing one at the test. A `given` carrying a section name
outside the vocabulary is left to E0714 alone — an input written under such a
name is that mistake rather than a missing argument, and its position stops
existing as soon as the section name is fixed.

Codegen throws the same sentence rather than emitting the `undefined`, for a
caller that skipped `check`.
