# Debugging Kumiki

## Read the diagnostic

```sh
kumiki check app.kumiki
```

Each diagnostic is one line that leads with its severity, code and position:

```
error E0103 undef-ref at 4:30: Reference to undefined name "total"
warning W0212 … at 2:17: …
```

For every code, run `kumiki guide <code>` (`kumiki guide E0103`). It prints that code's entry
from the error catalog of the spec this CLI ships with: the rule, why it exists, and the fix.
Read it before changing anything. `kumiki guide errors` prints the whole catalog.

- `error` lines fail `check` and `build`.
- `warning` lines do not: `check` exits `0` with `ok (N warnings)`. They still mark real bugs —
  `W0212` and `W0213` are a subscription or handler that never fires, so its reducer never runs.
  When `smoke` says an interaction did nothing, read the warnings first.

## Let `fix` propose a repair

```sh
kumiki fix app.kumiki          # show the planned repairs
kumiki fix app.kumiki --apply  # apply them
```

`fix` repairs names: it proposes the closest existing name for an undefined effect, reducer, tile,
type, variant or slot. It exits `1` while the file still has errors, so the dry run exits `1` when
it has something to propose — read its output, not the exit code.

It proposes nothing when two names are equally close (`close-names-tied`), and nothing for an
`E0103` whose message says the name *was declared in* or *is declared later in* another scope.
That read is out of scope, not misspelled, and a rename would read a different value. Move the
read into the scope that declares the name instead; the E0103 entry says how for each kind of
scope.

## "It checks, but misbehaves when it runs"

`check` and `build` prove syntax, types and codegen. They do not prove the app runs:

1. **`kumiki smoke app.kumiki`** — does it run? It mounts the app headless, drives every button,
   input and select, and reports the phase and interaction that threw
   (`[interaction] … is not a function (on input input[0])`) or an empty render.
2. **`kumiki run app.kumiki scenario.json`** — is the result correct? Only a scenario catches
   behavior that is wrong without throwing, such as a select that always picks the last option.
   See `kumiki guide iterate`.

Common causes: a method called on the wrong receiver (a `List` method on a `Map`), a `for`-rendered
tile without a `key`, a `bind=` whose root is not a slot (E0229), and a handler on a tile that never
fires its event (W0212 / W0213).

## When the framework is wrong

If the spec says your program should work and it does not, reduce it to the smallest program that
shows the difference, with a scenario that pins the expected behavior, and report it at
https://github.com/kumikijs/Kumiki/issues.
