---
"@kumikijs/compiler": minor
"@kumikijs/runtime": minor
---

Make every refinement predicate a check that can fail, stdlib nominals included

`docs/spec/forms.md` §5.6 and `language.md` §1.3.3 present a refinement as a
runtime check: the value is validated on its way into the slot, and a write that
fails is refused. Five of the twelve predicates were. `refinementToJs` ended in

```ts
default:
  return `(_v) => true`;
```

so `positive`, `negative`, `email`, `url`, `uuid`, `regex` and `one-of` reached
the runtime as a check that cannot fail:

```
slot n : Int where positive = 5
reducer bad on=ui.click(B) do= n := 0 - 7    # landed. n held -7.
```

The standard library's refined nominals were worse, by a different route.
`refinementJs` resolved a `TypeRef` through the program's own `type`
definitions, and `Email`, `Url`, `Uuid` and `HttpStatus` are synthesised in
`stdlib-types.ts` — so the lookup returned `undefined` before any predicate was
considered, and `slot e : Email = "not-an-email"` emitted no `refine` and no
`refineKind` at all. Every write was accepted, and `error(field=e)` on it
rendered nothing, on a form whose whole purpose was to say the address is not
one.

All twelve now lower. What each tests is written down in §1.3.3 rather than left
to the implementation: `positive` / `negative` are strict about zero, `email` is
`local@host` with a dot in the host, `url` is absolute (a scheme and an
authority — `kumiki.dev` is not one), `uuid` is the 8-4-4-4-12 shape in either
case, `regex` is anchored so the pattern describes the **whole** value, and
`one-of` is membership. A value of the wrong shape answers `false` rather than
throwing.

Codegen's type table is seeded with the standard library's definitions as well
as the program's, which is what lets the walk over a type's `where` clauses
reach them at all — so `slot e : Email`, `type Handle = Email` and
`slot e : Text where email` are one guarantee written three ways.

The `default` arm is gone in both directions. One table now holds the names the
parser accepts and the lowering each has, so the two cannot drift; a registered
predicate with no lowering is **E0803** `unimplemented-refinement` at build time
(nothing is in that state — it is the guard for the next predicate added to
§1.3.3). Arguments are checked too, as **E0804** `refinement-args-invalid`: a
refinement no value can satisfy is the same defect as one every value satisfies,
so `between(5, 1)`, `len-eq(2.5)`, `len-gt(-1)`, `regex("(")` and `one-of()` are
reported rather than lowered. `between(0, "x")` is the sharpest of them — the
emitted check read `v >= x`, a reference to a name nothing declares, and the
module threw at load.

Property-test generation moves with the runtime, since the two answer the same
question from opposite ends: `email` / `url` / `uuid` generate an instance of
the shape, `one-of` draws from the listed literals, and `negative` bounds the
sign — a generator that ignored them would drive a property over states the app
refuses to be in. `regex` has no constraint to fold and §8.3.2 now says so.

`packages/examples/features/90-refinement-validation.kumiki` writes to each
family from a reducer and its scenario asserts the refusal — the batch is
discarded whole, the rejection is reported, and `error(field=…)` on a pristine
`Email` slot renders its message.

**A program can stop working**, and it was already not doing what it said: a
write these predicates refuse used to land silently, and now discards its
reducer's batch ([runtime.md §10.3.3](https://github.com/kumikijs/Kumiki/blob/main/docs/spec/runtime.md)).
The repair is the one a reachable bound has always needed — guard the write, or
widen the slot's type and refine at the boundary.
