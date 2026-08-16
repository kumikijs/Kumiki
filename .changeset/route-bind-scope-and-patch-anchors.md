---
"@kumikijs/compiler": minor
"@kumikijs/cli": minor
---

fix(compiler): report a `$route` the runtime never binds (E0119), and fix the
patch composition it exposed.

**E0119 `route-bind-out-of-scope`.** `$route` is not a name in a table — it is a
payload field the runtime fills in, on the route lifecycle path (`route.enter` /
`route.leave` / `route.error`) and on a link's prefetch path, and nowhere else.
Every other reducer read `{}`: each field off it came back `undefined`, so every
comparison against one was quietly false and the body did nothing. The check
names the `route` slot, which holds the current route and is readable from every
reducer, and `kumiki fix` proposes that rewrite.

The exemption for a prefetch target is by NAME, and deliberately so: a reducer
has one trigger and the check has no path sensitivity, so a reducer that is both
a prefetch target and triggered some other way is not reported on either path.
Exempting is the side that never rejects a working program.

The spec moved to match the runtime rather than the other way round: it named
enter/leave, and the runtime has always also bound `route.error` and the
prefetch target — `routing.md` §3.4 and `language.md` §1.6.5 now name all four.

**`kumiki fix` composes a plan by what each patch disturbs.** `AutoPatch` gains
a required `anchor`: `span` (writes at a position — composed from the right),
`line` (rewrites the first match on its line, so it can move a column no
position predicts — composed after every span), `region` (adds or extends text
elsewhere — composed last). Without it, one repair moved the column another was
measured at, the regression gate read the moved diagnostic as introduced, and
the whole plan rolled back with the file unchanged. `runFixFromTest`'s tier-1
repair, which writes with no gate at all, composed the same way and landed half
a plan.

A name-suggest repair now writes at the reported position when the position
really holds the name it quotes, and falls back to the line scan only where it
does not (E0211 reports at the reducer and names a tile).

Repairs no longer rewrite a file's line endings: editing a line used to
round-trip the whole file through `split(/\r?\n/).join("\n")`, turning a
one-token repair into a whole-file diff on any CRLF checkout.
