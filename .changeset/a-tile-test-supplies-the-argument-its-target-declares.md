---
"@kumikijs/compiler": minor
---

Refuse a `tile-test` whose `given.in` disagrees with its target

A `tile-test` applies its target: the lowering applies `App._tilesById["<T>"]`
to `given.in`. Nothing checked that the argument matched the target's
declaration, so a test that omitted the `in` its tile declares passed
`undefined`:

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

— no test name, no position, no code. Nothing catches that, so it reached the
CLI and every other test in the file lost its result with it. The mirror case —
an `in` given to a target that declares none — was dropped, so the test asserted
a render that never saw the value it was written for.

The count is E0213 now, in the sentence the tile-call form already uses, because
a `tile-test` is one such call: `Tile "Card" expects 1 argument(s) but got 0`.
An `in` the target does not declare is reported at the section, which is the
text to delete; a missing one at the test. A `given` carrying a section name
outside the vocabulary is left to E0714 alone — an input written under such a
name is that mistake rather than a missing argument.

The count alone was not enough, because the type is what separates a loud
failure from a silent one: `show` renders a wrongly typed value as the empty
string just as it renders an absent one, so `in: 42` against `in=Text` compared
the snapshot against something indistinguishable from an empty label and
*passed*, asserting a shape no tile call can produce. So `given.in` is now
compared with the target's `in=` through the same rules a tile call's argument
goes through — E0201 for the value, E0214 / E0215 for a record's fields — at the
value's own position.

A `tile-test` naming a **built-in** tile is E0105: `_tilesById` is built from the
user tiles alone, so `tile-test text` passed `check` and then died with
`App._tilesById.text is not a function`, taking the file's other results with it.
It could not work whatever it was given, so the count is not what is wrong with
it.

Codegen throws rather than emitting the `undefined`, for a caller that skipped
`check`. The throw names the code and repeats the checker's sentence under its
own prefix: `E0213 tile-test "t": Tile "Card" expects 1 argument(s) but got 0`.

**Migration.** Three `tile-test` shapes that passed before now fail `check`:
`given.in` written against a target declaring no `in=` — including `in: ()`, the
spelling `docs/spec/testing.md` §8.4 taught until this release — should be
deleted; a missing `in` against a target that declares one should be written;
and an `in` of the wrong type should be corrected to the declared one. A
`tile-test` naming a built-in tile should name the tile that renders it.
