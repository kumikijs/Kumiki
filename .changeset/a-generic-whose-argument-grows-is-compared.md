---
"@kumikijs/compiler": patch
---

Comparing a generic whose recursive occurrence grows its argument terminates

```
type G(T) = Leaf(T) | Node(G(List(T)))

fn same(g: G(Int)) -> G(Int) = g     # check never returned; now ok
```

`G` reaches a union before it reaches itself, so it is a legal recursive type
(language.md, invariant 4 of the recursive types), but `kumiki check` never
finished on it: the relation answers yes when it re-enters a pair of types as
written, and unfolding `G` writes a new pair at every level. The same happened
to a write `x := y` between two `G(Int)` slots, to a `List(G(Int))`, an
`Option(G(Int))` or a record field typed `G(Int)`, and to `G(Int)` where
`G(Float)` is required.

Two applications of one generic are now compared argument by argument, each
argument read the way unfolding the body would read it: not at all when no
comparison reaches it, past every nominal where a `nominal` wraps the parameter
itself, and as written otherwise. Where a side of any other comparison applies a
generic that nests its argument deeper, such as `G` against an identically shaped
`H`, re-entries that grew are counted for each pair of heads, and every re-entry
past the 64th answers yes. A program that applies no such generic, and whose
unions name each variant once, gets the answers it got before.

`packages/examples/features/219-non-regular-recursive-type.kumiki` builds a
value two levels down, passes it through a `fn` typed `Nest(Int) -> Nest(Int)`
and writes it into a slot, and its scenario checks what it renders.
