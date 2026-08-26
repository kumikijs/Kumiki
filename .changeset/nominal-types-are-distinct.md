---
"@kumikijs/compiler": minor
---

fix(compiler): tell two `nominal` types apart.

`unaliasType` stripped `nominal` before comparing, and every caller of the
assignability relation went through it — so a nominal type accepted any other
nominal over the same base:

```kumiki
type Cents = nominal Int where positive
type Yen   = nominal Int where positive
slot c : Cents = 1
slot y : Yen   = 2
reducer mix on=ui.click(B) do= c := y      # ok
```

Which is the one mistake `nominal` exists to catch, and the shape it guards is
everywhere: `packages/examples/apps/03-blog` declares `PostId` and `UserId` as
`nominal Text where uuid`, and `05-project-management` declares three such ids.
Confusing two of them was accepted by `check`, `build` and `smoke` alike, and
showed up as the wrong row being loaded.

A nominal type is now identified by **the name it is declared under**. Two
declarations over one base reject each other with `E0201`, naming both types as
written — `Expected Cents but got Yen`. An alias to a nominal names the same
type, and a `nominal` written inline at a use site declares no name and is still
compared structurally.

A nominal and its **base** accept each other in both directions, so nothing that
compiled for the right reason stops compiling: `slot c : Cents = 1` needs no
construction form, arithmetic yields the base so `c := c + 1` stands, and a
deliberate conversion is a `fn` declared with the nominal return type. Every
example, benchmark, spec block and fixture in the repo passes unchanged.

**Breaking** for a program that mixed two nominals: the standard library's
`Url`, `Email`, `Uuid`, `HttpStatus` and `Duration` are nominals too, so
`slot e : Email = someUrl` is now an error where it used to compile.

The refinement is unaffected and remains a runtime check — `slot e : Email =
"not-an-email"` is still accepted by `check` and still fails at validation. So
are the operators: `==` is defined on every type and ordering asks only whether
both sides are numbers, so `cents < yen` is not reported.

`docs/spec/language.md` §1.3.5 and `docs/spec/errors.md` E0201 disagreed about
this — §1.3.5 said `nominal` makes a new type, E0201 said it was transparent —
and both now state the rule above.
