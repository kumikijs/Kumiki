---
"@kumikijs/runtime": minor
---

fix(runtime): a keyed reorder now places only the children that have to move,
so a focused child the reorder leaves alone keeps its cursor natively.

The reorder phase of the keyed child pass replayed the whole target sequence
with `appendChild`. That produces the right order for any permutation and is one
line, but it detaches and re-attaches **every** child on every render that
reaches the keyed path — including the ones already in their final position, and
including renders where nothing moved at all.

Re-attaching a node blurs it. Focus, the caret in a text field, an open
`<select>` dropdown and an in-flight IME composition are exactly the state keyed
matching exists to preserve, and the sweep spent it on children that had no
reason to move. That was papered over by the render pass's focus restore
(§10.3.9), which is a snapshot/restore fallback — the guarantee §10.3.11 makes
is that the patch path does not need it. Underneath the correctness cost sat a
throughput one: N DOM moves per render for a list that is stable, which is the
common case.

**The fix.** The survivors whose old positions already ascend stay untouched,
taken as the longest such run so the fewest children are left over; everything
else is inserted against its successor, right to left, so each anchor is final
by the time it is used. Fresh mounts and removals slot into the same pass. A
render that does not change the order performs no DOM placement at all, one item
moving costs one, and the worst case — no two children keeping their relative
order — costs N−1.

Placement also stopped going through `appendChild`. The pass now inserts against
the node the mounted child list ends on, read before any rebuild or removal can
invalidate it, so a renderer that keeps content of its own after its children
keeps it there. The sweep walked the children past it.

**What is not covered, and why.** No example accompanies this. The difference is
not observable from a `.kumiki` program at any tier the repo has: element
identity was preserved before and after (a move is not a rebuild), and for the
element kinds a browser fixture can inspect — `<input>`, `<textarea>`,
`<select>` — the focus-restore layer puts focus and the selection range back,
which is what made the bug survivable in the first place. What is observable is
the DOM operations, and those are asserted in the runtime unit tier: the count
per transition, and that a focused child which did not move is never passed to
the container's `insertBefore` / `appendChild`. The accompanying `blur` listener
states the consequence a user feels but does not enforce it there — happy-dom
does not model a moved element losing focus.

`measure:keyed-moves` reports the counts against both the hand-derived minimum
and the sweep. At 500 rows the sweep moved 500 children for unchanged, one-item,
insert and remove alike; the measured counts are now 0 / 1 / 0 / 0, and 499 for
a full reversal.
