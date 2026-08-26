---
"@kumikijs/compiler": minor
"@kumikijs/cli": patch
---

fix(compiler): resolve the names a test body writes, and a call's qualifier.

Two holes of the same kind: a name that resolved to nothing, accepted because
nothing asked.

**A test body was not name-resolved at all.** `checkTest` walked a `given` for
misplaced wildcards, an invariant for `run-reducer`'s target, and an `expect`
for `<slots.X>` — none of which reaches `checkExpr`. What the lowering could
not read, it dropped:

| Written | `check` | `kumiki test` |
|---|---|---|
| `given = {slots: {conut: 3}}` | ok | passes — against the slot's default |
| `given = {event: {target: Nope}}` | ok | passes — the target is dropped either way |
| `invariant = doubel(n) == n * 2` | ok | "counterexample at n = 0" |

The last one is the sharpest: the property runner catches the trial's
`doubel is not defined` and renders it as a falsified invariant, so the output
accuses the code under test of a bug it does not have.

A test body cannot simply be handed to `checkExpr`, because it is a schema:
`event: {type: ui.click, target: B}` is an event pattern, `effects: [persist(x)]`
is a list of effects rather than of calls, and `mocks: {persist: err("x")}` is
neither. Each position is checked as what codegen lowers it as — a slot key is
a slot, an `effects` entry is an effect (standard ones included), an event
`target` is a tile when the trigger is a `ui.*` one, and everything the
lowering evaluates is an expression. `docs/spec/testing.md` §8.1.1 is the table.

Two positions are checked for *shape*, under the new **E0713**, because an
unrecognised one is not ignored but re-interpreted: a `reducer-test` mock that
is not `ok(...)` / `err(...)` / `delay(...)` became a *success* mock, so a test
asserting what happens when an effect fails passed without ever failing it; and
an `expect.effects` that is not a list became the assertion that no effect was
emitted, so a forgotten pair of brackets replaced the test rather than
weakening it. Both throw at codegen too, so the check and the lowering cannot
drift apart.

`run-reducer` is refused outside a property-test invariant, where alone it can
lower: elsewhere the generated module reads `_init`, which nothing binds, and
the whole suite dies with `_init is not defined` before a single test reports.
Its argument is counted and required to be a reducer name — `run-reducer("inc")`
reached the runner as `reducer "" not found`.

**A call's qualifier resolved to nothing.** `T.fresh()` / `T.parse(t)` /
`T.show(v)` lower on any capitalised `T`, because codegen matches the shape by
regex — and the checker took that as its own rule. `parse` branches on the
qualifier, so a misspelling changed the value instead of failing:
`Int.parse("12")` is `Some(12)` and `Itn.parse("12")` is `Some("12")`, which an
`Int` slot then holds and every later sum concatenates. `fresh` and `show`
discard it, so those are checked because a qualifier naming no type is wrong on
its own terms. It is `E0117` now, with the sentence `resolveType` already
produced, so `kumiki fix`'s did-you-mean over type names covers it — and
`Int.pasre(t)` gets one too, built from the qualifier the author wrote.

**Breaking**, in two places:

- A test that named something undeclared no longer compiles: a slot key with a
  typo, a `ui.*` event target that is not a tile, the old
  `event: {kind: click, tile: B, id: none}` spelling (whose `kind` and `id`
  values name nothing), and the two shapes above.
- `T.fresh()` and `T.show(v)` on an undeclared type are now `E0117`. Codegen
  ignores the qualifier for those two, so this rejects a program that ran
  correctly — `SessionId.fresh()` with no `type SessionId` is the shape to
  expect.
