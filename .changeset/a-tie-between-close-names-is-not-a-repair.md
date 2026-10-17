---
"@kumikijs/cli": patch
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
---

Refuse to repair a misspelt name that two names are equally close to

`kumiki fix` kept the first candidate it met at the best distance, so when two
names were equally close the answer was decided by the order the definitions
appear in the file:

```kumiki
slot countA : Int = 0
slot countB : Int = 0
…
tile App  = column(BtnA, BtnB, text("total: " + count.show))
```

```
$ kumiki fix app.kumiki
E0103 Reference to undefined name "count"
  fix: replace "count" with "countA" at 9:49
```

Swapping the two `slot` lines answered `countB`, and `--apply` wrote either one
and reported `applied 1 fix(es) — file now clean`, exit 0. Every close-name
repair shared it: E0102, E0103, E0105, E0107, E0211, E0104, E0106, E0116,
E0117, E0118, E0209 and E0216. `Duration.x` became `Duration.s` rather than
`Duration.m`, `.h` or `.d` because it is listed before them.

A tie is now no repair. `kumiki fix` proposes nothing for it and `--apply`
writes nothing and exits 1:

```
$ kumiki fix app.kumiki
(no auto-patches available)
E0103 Reference to undefined name "count"
```

The skip says why: its reason is `close-names-tied`, and the new
`SkipReason.candidates` lists the tied names in sorted order (`["countA",
"countB"]`). A name the program declares still outranks a built-in one at the
same distance, as it did for types and effects — `Filtre` is two edits from a
declared `Filter` and from the built-in `File`, and the repair writes `Filter` —
but by rule now rather than by being listed first. The rule reaches E0116 too:
a declared `fn` beside a built-in call one edit away from the same typo
(`nox` → `nov` / `now`) used to go to the built-in, which was listed first, and
goes to the `fn`.

The verification tiers' unknown-reducer message reads the same ranking and
names every tied reducer, where it named the first one declared:

```
action failed: no reducer named "add" — did you mean "addA" or "addB"?
```

`@kumikijs/runtime` (re-exported by `@kumikijs/compiler`) gains `nearestNames`,
which answers every candidate at the best distance, sorted, and takes the
preferred names as an optional third argument. `nearestName` answers `null` on a
tie instead of the first candidate.
