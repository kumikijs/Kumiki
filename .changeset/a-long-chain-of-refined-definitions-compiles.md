---
"@kumikijs/compiler": patch
---

A long chain of aliases that add `where`s compiles, and checks in linear time

```
type T0 = Int where between(0, 1000) where between(-1000, 1000) # ... 250 `where`s
type T1 = T0 where between(-1000, 1000) # ... 250 `where`s
# ... each Tn adds 250 `where`s to T(n-1) ...
type T39 = T38 where between(-1000, 1000) # ... 250 `where`s

slot x : T39 = 7
```

The parser's depth budget counts the `where`s on one type expression, so every
definition here is within it, and nothing bounds how many definitions a chain
passes through. Before, `kumiki check` on this program crashed with
`RangeError: Maximum call stack size exceeded`. Type normalisation, the
nominal-declaration lookup, the refinement-position scan and codegen's
predicate collection each recursed once per name and once per `where`, so the
10,000 steps here were more frames than the stack has. A chain of 6,000
definitions with no `where` at all overflowed the same way.

A chain short enough not to overflow was still slow, because the checker
normalised the whole chain below every `where` it judged. Each step also copied
the set of names walked so far, and the cycle check built a fresh forwarding
classifier for every definition. With one `where` per definition:

| definitions | check before | check after |
| ----------- | ------------ | ----------- |
| 250         | 173 ms       | 21 ms       |
| 500         | 1.05 s       | 48 ms       |
| 1,000       | 8.4 s        | 43 ms       |
| 1,500       | 30.9 s       | 74 ms       |
| 20,000      | overflow     | 371 ms      |

After, the 40×250 program checks in about 160 ms, and codegen takes about 40 ms.
Each slot's check still holds all 10,000 predicates, and a rejected value is
still reported against the first predicate it fails, read from the base
outward. Each of the walks named above is now a loop. Each name's normal form is
recorded once per compile, so a later walk stops at a name it has already
followed. `unaliasType` and `refinementsOf` are one walk, so they cannot
disagree about where a chain goes.

A check carrying more than one predicate is emitted as one statement per
predicate (`if (!(…)) return false;`) instead of one `&&` expression.
Node loads the `&&` form at any length. Rollup and rolldown both walk an `&&`
chain by recursion, though, and fail on one a few thousand terms long, which a
chain like the one above reaches. With the checker fixed and the `&&` form
kept, a Vite build of the program above crashed in rolldown. A
check with a single predicate is emitted as before. Every example except the
two with conjoined predicates builds byte for byte as it did.
