---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

`check` / `switch` / `radio` honour `bind=`

`check(bind=b)` and `switch(bind=b)` show the bound `Bool` and write the box's
new state back when it is ticked; `radio(group=…, bind=f, value=V)` is selected
exactly when `f == V` and writes `V` when chosen (forms.md §5.1.1, §5.5.2). The
compiler accepted `bind=` on all three and codegen dropped it, so every box
rendered unticked and clicking one wrote nothing. The write goes through the
same path as `input` — refinement refusal, the `data-kumiki-bind` marker, SSR —
and runs before the control's own `onClick` / `onChange`, so a handler reads
the slot already written. A `check` / `switch` bound to something other than a
`Bool` is E0201 at `kumiki check` time, a radio `value` of another union E0216.

**New error, E0225 `radio-bind-without-value`**: a `radio` with `bind=` and no
`value=` has nothing to write when chosen. It used to write `undefined` into
the slot, then show itself chosen while every `match` on the slot fell through.

**New warning, W0216 `selection-beside-bind`**: `value=` on a `check` /
`switch`, or `selected=` on a `radio`, written beside a `bind=` is not read —
the bound value decides the selection.

Focus now stays on the radio a user chose. Every radio of a bound group
carries the same `data-kumiki-bind` marker, and restoring focus after the
re-render took the first control carrying it; a marker more than one control
carries now falls through to the id and the DOM path.
