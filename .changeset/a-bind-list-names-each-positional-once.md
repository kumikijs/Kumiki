---
"@kumikijs/compiler": minor
---

Reject an effect bind list that names one identifier twice (E0123)

`on=ping.ok(dup, dup)` bound two of the payload's positionals to one name.
Codegen emits one `const` per bind, so the reducer body declared it twice:

```js
const dup = _payload["$1"];
const dup = _payload["$2"];
```

The module threw `SyntaxError: Identifier 'dup' has already been declared` at
load and nothing rendered, with `check` and `build` both clean.

A bind list names the payload's positionals **in order**, so two binds naming
one thing is not an abbreviation for anything — whichever value the name
resolved to, the other positional would have no name to read it by. That is
**E0123 `duplicate-effect-bind`** now, reported at the second bind and naming
both positionals: E0122's rule at the trigger rather than at a pattern, and
E0121's collision from the other side.

`_` stays exempt however often it is written, and occupies a position rather
than skipping one, so `on=load.ok(_, x, x)` is a collision between `$2` and
`$3`. A repeated name that is *also* a reserved one collects E0121 per bind
and no E0123: those reports already say to rename the bind, and renaming it
settles the duplicate too.
