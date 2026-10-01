---
"@kumikijs/runtime": patch
---

A form submits only while the fields bound inside it are valid

forms.md §5.2.2 calls a form's `ui.submit` reducer only when every bound slot
passes validation; the submit listener called it unconditionally. So a field
showing a refused address beside "Invalid email format" still submitted, and
the reducer read the slot's last accepted value rather than what the field
showed. The form now judges every slot a control inside it binds on what the
controls show — the judgement `error(field=…)` makes, through one shared
`judgeShownField` — and does not call the reducer while any fails, whether the
submit comes from a button or Enter.
