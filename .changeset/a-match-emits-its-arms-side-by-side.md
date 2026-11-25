---
"@kumikijs/compiler": patch
---

A `match` with thousands of arms emits JavaScript the engine can parse

Codegen chained a `match`'s arms with `else if`, so each arm sat one level
deeper in the emitted JavaScript than the one before it. A long enough match
compiled `ok` and then could not be loaded: `node --check` on the output threw
`RangeError: Maximum call stack size exceeded`. How many arms that took differs
by platform; on Linux x64 under Node 24 it was about 5,600 at the default stack
size. The same held for a match in an expression, in a reducer body and in a
tile body.

The arms now sit side by side, so the output nests no deeper for 1,000 arms
than for 2.

What a match does is unchanged: the first arm whose pattern holds is the only
one that runs, and when none holds an expression panics (a value match whose
arms leave out a value of its type is E0227 at check), a statement writes
nothing and a tile body renders an empty `text`.
