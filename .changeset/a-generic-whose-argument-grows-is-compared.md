---
"@kumikijs/compiler": patch
---

Comparing a generic whose recursive occurrence grows its argument terminates

```
type G(T) = Leaf(T) | Node(G(List(T)))

fn same(g: G(Int)) -> G(Int) = g     # check never returned; now ok
```

`G` reaches a union before it reaches itself, so it is a legal recursive type
(language.md §1.3.6, inv. 4), but `kumiki check` never finished on it. The
relation reads a recursive type co-inductively, answering yes when it re-enters
a pair it is already comparing, and keys that pair on the types as written.
Unfolding `G` writes a new pair at every level — `G(List(Int))`, then
`G(List(List(Int)))` — so no pair ever repeated: the comparison went one level
deeper at a time, copying a longer key at each, and `check` printed nothing for
as long as it was left to run. The same happened to a
write `x := y` between two `G(Int)` slots, to a `List(G(Int))`, an
`Option(G(Int))` or a record field typed `G(Int)`, and to `G(Int)` where
`G(Float)` is required.

Two applications of one generic are now compared argument by argument, each
argument read the way unfolding the definition would read it: not at all when
the body never compares it, past its own nominal under a `nominal` generic
(`type Tagged(T) = nominal T`), and as written otherwise. That is the answer
unfolding gives wherever it ends, so regular generics keep every answer they
had — `Box(Int)` into `Box(Text)` is still E0201, a phantom parameter still
accepts any argument, `Tagged(Yen)` still meets `Tagged(Cents)` — and a write of
the wrong type (`x := 5`, or a `G(Text)` into a `G(Int)`) is still E0201.

Two different generics that both grow (`G` against
`type H(T) = Leaf(T) | Node(H(List(T)))`) cannot be compared by their
arguments, so they are still unfolded side by side, and what is counted is the
growth: re-entering a pair of definitions with larger types than the last time
counts once, and past 64 of those in one comparison the next answers yes, as a
repeated pair does. Re-entries that did not grow are not counted, so two
generics that swap their parameters (`type SA(T, U) = SLeaf(T) | SNode(SA(U, T))`
and an `SB` like it) still end at a repeated pair however many fields of one
record compare them, and a mismatch one level down in the last field is still
E0201.

`packages/examples/features/219-non-regular-recursive-type.kumiki` builds a
value two levels down, passes it through a `fn` typed `Nest(Int) -> Nest(Int)`
and writes it into a slot, and its scenario checks what it renders.
