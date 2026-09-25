---
"@kumikijs/compiler": patch
---

A builtin's content is its first positional argument, so a named argument written before it stays a prop instead of replacing it (#393).

`heading(level=2, title)` rendered `2` and dropped `title`; `text(test-id="x", n.show)` rendered `x`. Lowering read `args[0]` for the content of `text`, `heading` and `markdown` whatever that argument's name was, while `code` and `editable` already took the first positional one. All five now read it through one helper, the same one the user-tile call takes its input through (#330), so the checker's count of positional arguments and what codegen renders are one rule. A call with no positional argument still renders `""`.
