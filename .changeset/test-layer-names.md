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
| `given = {event: {target: Nope}}` | ok | passes — against no target |
| `invariant = doubel(n) == n * 2` | ok | "counterexample at n = 0" |

The last one is the sharpest: the property runner catches the trial's
`doubel is not defined` and renders it as a falsified invariant, so the output
accuses the code under test of a bug it does not have.

A test body cannot simply be handed to `checkExpr`, because it is a schema:
`event: {type: ui.click, target: B}` is an event pattern, `effects: [persist(x)]`
is a list of effects rather than of calls, and `mocks: {persist: err("x")}` is
neither. Each position is checked as what codegen lowers it as — a slot key is
a slot, an event target is a tile, an `effects` entry is an effect, and
everything the lowering evaluates is an expression. `docs/spec/testing.md`
§8.1.1 is the table.

**A call's qualifier resolved to nothing.** `T.fresh()` / `T.parse(t)` /
`T.show(v)` lower on any capitalised `T`, because codegen matches the shape by
regex — and the checker took that as its own rule. But the qualifier decides
which branch of the lowering runs, so a misspelling changed the value instead
of failing: `Int.parse("12")` is `Some(12)` and `Itn.parse("12")` is
`Some("12")`, which an `Int` slot then holds and every later sum concatenates.
It is `E0117` now, with the sentence `resolveType` already produced, so
`kumiki fix`'s did-you-mean over type names covers it — and `Int.pasre(t)` gets
one too, built from the qualifier the author wrote.

**Breaking**: a test that named something undeclared no longer compiles. The
ones worth expecting are a slot key with a typo, an event target that is not a
tile, and the old `event: {kind: click, tile: B, id: none}` spelling, whose
`kind` and `id` values name nothing.
