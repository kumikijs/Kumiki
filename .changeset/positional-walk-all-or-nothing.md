---
"@kumikijs/runtime": minor
---

fix(runtime): the unkeyed child walk now decides the parent's fate before
applying any of it, so a render that rebuilds a parent no longer reports the
children it threw away.

The structural child walk reconciled children one at a time, and two of its
give-up conditions — a hole in the child list, and an old child with no element
mapping — were discovered mid-list. By the time index `i` failed, children
`0..i-1` had already been patched in place or had their subtrees rebuilt, and
each had pushed an identifier onto the reconcile-touched set. The parent was
then thrown away and rebuilt, discarding that work. The identifiers stayed.

That set becomes the episode log's `signal-update.binds-updated` (§10.3.11).
An episode is the author-facing causal record — "slot `X` changed → tiles `A`,
`B` updated" is a claim the runtime makes about what happened, and here `A` and
`B` did not survive the render. The same partial pass could emit a diagnostic
(§10.3.12) for a subtree the very next line discarded: a `no-patcher` naming a
rebuild that was undone before the render finished.

Underneath sat an unstated assumption. The `newMap` entries those children
wrote self-healed only incidentally — the parent's rebuild walks the same child
nodes through `ctx.render`, which overwrites them. True of every renderer that
goes through `ctx.render`, but a coincidence of the current codegen rather than
a rule, and never something a host renderer was asked to honour.

Both bail conditions are now resolved for the whole child list before the walk
starts, so the pass either runs to the end or never begins. A bail leaves no
trace of the subtree: no DOM change, no touched identifier, no `newMap` entry —
and nothing left for the rebuild to overwrite, so the assumption is gone rather
than restated. The evidence a bail carries is unchanged: the scan asks the same
questions in the same order, and still reports the same `reason`, `index` and
`childKind`.

Reachable only from a host-built tile tree — Kumiki codegen flattens nils away
and routes every child through `ctx.render` — so no authored app changes
behaviour. What changes is that the log an author reads is true for the ones
that do reach it.
