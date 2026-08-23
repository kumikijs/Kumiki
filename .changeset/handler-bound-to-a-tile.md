---
"@kumikijs/compiler": minor
---

fix(compiler): a handler bound to a tile name is reported instead of dropped.

`box(text("x"), onClick=Card)` passed `check` and compiled into an element
with no listener. A capitalised name written as a named argument of a builtin
that takes tiles parses as a tile call, and the checker asked what shape the
argument had before it asked whether the argument was a handler — so the
binding was checked as a nested tile and never reached the handler branch.
Codegen made the same reading and captured nothing, and the handler-name skip
that builds the element payload dropped it from the props as well. Both halves
agreed, which is why nothing reported it: the tile rendered, the click did
nothing, and no diagnostic anywhere said why.

The handler is now asked about first, in both forms and for every handler name,
and answers `E0201` — the same code `onClick=1` already gave. `W0213` comes
with it when the tile does not fire that event, as it already did for the
props-block form, which parses the same name as a variant tag and reported it
all along.

The cycle search made the same mis-reading one layer down: a handler naming an
enclosing tile reported `E0005`, that the tile "expands into itself", about a
tile that is never rendered there. It now skips handler arguments too. Only
programs that this release starts rejecting can reach that path — a handler
that names a reducer is a plain reference, which contributed no expansion edge
before or now.
