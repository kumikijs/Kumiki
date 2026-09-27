---
"@kumikijs/compiler": minor
"@kumikijs/cli": patch
---

A value builtin now renders the content argument it is written with, or
reports the one it would drop as **E0129 `unrendered-arg`**.

Each value builtin reads its content from one place, now one table the checker
and the lowering share: `text` / `heading` / `code` / `markdown` from their
first positional argument; `link` / `label` / `editable` from their first
positional argument, or `text=` when none is written; `image` / `icon` from
`src=` / `name=`.

`label("Name")` and `link("Home", to="/x")` now render their label. The
positional argument was parsed, type-checked and dropped, so both rendered
empty. With `text=` also written, the positional argument wins, as it already
did for `editable`.

An argument written as content that the builtin never reads is E0129, at that
argument:

```
text("FirstA", "SecondB")      # SecondB was dropped
heading(text="Title")          # rendered an empty heading: text= is a prop here
image("a.png", alt="a")        # image reads src=
```

`kumiki fix` repairs the `text=` shape by making the value the positional
content (`heading(text=title)` → `heading(title)`); a dropped positional has no
single repair and is reported as skipped.
