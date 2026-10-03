---
"@kumikijs/compiler": minor
---

Report a `type` whose alias chain resolves to itself

The definition-cycle check covered a tile that expands into itself (E0005), a
slot initializer that reads a slot (E0304) and a `fn` that calls itself (E0006).
A `type` written in terms of itself was not one of them:

```
type A = A
slot x : A = 1        # was ok

type A = B
type B = A
slot x : A = 1        # was ok
```

Neither type has a meaning — there is no body to reach — so a slot declared with
one silently got no type at all and every value-level check on it went quiet.
That is the same silence a misspelled type name produced before E0117. The
normalisation helpers already survived the shape by returning "undecidable" on
re-entry, so the cycle was handled by every consumer declining to answer rather
than by anyone reporting it.

Both are now **E0009 `type-cycle`**, named and positioned the way the other two
cycle codes are — once per cycle, at the loop's first edge, inside the
definition the message names:

```
E0009 type-cycle at 1:10: type "A" resolves to itself (A → B → A)
```

The chain followed is the one normalisation follows, and it stops where
normalisation stops. An alias, a `nominal` wrapper, a `where` refinement and a
generic that hands one of its parameters straight back all lead on to the next
name; a record, a union, a primitive and a container are types in their own
right, so no name written inside one is an edge. **Recursive types stay legal**,
which is the point of drawing the line there:

```
type Node  = {value: Int, next: Node}
type Tree  = {children: List(Tree)}
type Shape = Leaf | Branch(Shape, Shape)
type A     = Option(A)
```

Each reaches a structural type before it reaches itself. Comparing two of them
terminates because the relation is read co-inductively over the types *as
written* — not because their values are finite: `Node` above has none at all,
its `next` being neither optional nor a container, and is the spec's own lead
example of a legal recursive type.

The forwarding generics are the case where substitution decides what comes next,
so the chain follows the argument written at that position:

```
type Alias(T) = T
type A = Alias(A)        # E0009, and was `ok` — it built and it ran
type B = Alias(Option(B))  # legal: the argument is a container
```

A name denoting no `type` definition ends the chain rather than closing it, so a
generic constructor (`List`, `Option`, `Map`) is not an edge and an undeclared
name stays E0117's alone. A standard-library *domain* type is a definition like
any other, so redeclaring one (`type Route = Route`) closes a loop through the
program's own. A parameter is read as the parameter and never as a global of the
same spelling (`type Alias(Cents) = Cents` is its argument).

`unaliasType` also stops answering with a type that cannot be compared: a
`TypeApp` re-entered on its own chain now returns "no normal form" like a
`TypeRef` already did, so `type A = Alias(B)` / `type B = Alias(A)` reports the
cycle instead of `Expected A but got Int` against the literal.

`unaliasType` and the nominal-chain walk keep their own re-entry guards
regardless: normalisation has to terminate on a program the checker is still in
the middle of reporting.

The rule this adds is normative in `language.md` §1.3.6 (Type Layer Invariants)
on both tracks, where the sibling cycle codes have theirs, and `errors.md` E0009
links there.

A program relying on the old silence stops compiling, and it was already wrong —
nothing was being checked against the type in question. Give one name on the
chain a body: a type meant to be recursive wants a record or a union where it
names itself, and a type meant to be an alias wants the definition it was
aliasing.
