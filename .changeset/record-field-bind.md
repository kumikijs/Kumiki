---
"@kumikijs/compiler": patch
"@kumikijs/runtime": patch
---

A `bind` into one field of a record slot is judged at that field

With a refinement written inside a record type, `input(bind=form.age)` was
refused whenever any field of the record failed — so a pristine form whose
default fails several fields could only be filled in one order, silently. A
bind write is now judged at the path it writes (forms.md §5.6): the predicates
along it, the slot's own included, and everything below where it ends; a
failing sibling no longer refuses it. The generated per-type explainer takes
the bind path as an optional focus, and a refused field is remembered as its
own value and laid over the slot as it now is, so `error(field=…)` judges
what every field shows even after a sibling is written.
