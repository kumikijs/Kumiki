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
and a `check` / `switch` bound to something other than a `Bool` is E0201 at
`check`, a radio `value` of another union E0216.
