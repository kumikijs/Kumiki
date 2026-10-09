---
"@kumikijs/compiler": patch
---

A `match` with thousands of arms emits JavaScript the engine can parse

Codegen chained a `match`'s arms with `else if`, so each arm sat one level
deeper in the emitted JavaScript than the one before it. A long enough match
compiled `ok` and then could not be loaded: with 1,800 arms, `node --check`
on the output threw `RangeError: Maximum call stack size exceeded` on one
machine, and on Linux x64 the default stack ran out between 5,000 and 8,000
arms. The same held for a match in an expression, in a reducer body and in a
tile body.

The arms now sit side by side, one `if` per arm in source order, so the output
nests no deeper for 2,000 arms than for 3. A match that answers a value — an
expression, or a tile body — returns from each arm:

```js
// before
((_v) => { if (_s.variantIs(_v, "Red")) { return "stop"; } else if (_s.variantIs(_v, "Amber")) { … } else { return undefined; } })(l)
// after
((_v) => { if (_s.variantIs(_v, "Red")) { return "stop"; } if (_s.variantIs(_v, "Amber")) { … } return undefined; })(l)
```

and a match statement in a reducer body breaks out of a block labelled around
its arms, labelled by how many match statements enclose it, so a match in an
arm of another leaves only its own block:

```js
// before
{ const _v = …; if (_s.variantIs(_v, "Red")) { … } else if (_s.variantIs(_v, "Amber")) { … } }
// after
_m0: { const _v = …; if (_s.variantIs(_v, "Red")) { …; break _m0; } if (_s.variantIs(_v, "Amber")) { …; break _m0; } }
```

What a match does is unchanged: the first arm whose pattern holds is the only
one that runs, and when none holds an expression answers `undefined`, a
statement writes nothing and a tile body renders an empty `text`.
