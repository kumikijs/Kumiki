---
"@kumikijs/compiler": patch
---

An event handler written in its props-block form, `onClick=Bump {}`, now parses on a user tile and on a value builtin such as `link`, and binds the reducer as `onClick=Bump` does.

language.md says `onClick=Bump`, `onClick=Bump()` and `onClick=Bump {}` are one node after parsing. That held on the builtins other than the value builtins, where a capitalised handler parses as a tile call. On any other tile, the handler parsed as an expression, which left the `{` unconsumed:

```
tile Btn = button(text="go")
tile Go  = Btn(onClick=Bump {})
# before: Parse error at 2:29: Expected op()), got op({)
# after:  ok, and a click runs Bump
```

On those tiles a capitalised handler followed by `(` or `{` now takes the call form too. A call that carries nothing (`Bump()`, `Bump {}`, `Bump() {}`) is the variant tag `Bump` is there, so all the spellings are still one node on every tile. One that carries props or arguments (`onClick=Bump {x: 1}`) is E0201 "must be a reducer name", reported once, as on a builtin; on these tiles it was a parse error.
