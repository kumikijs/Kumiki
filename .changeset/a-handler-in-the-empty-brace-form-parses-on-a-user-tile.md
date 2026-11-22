---
"@kumikijs/compiler": patch
---

An event handler written as `onClick=Bump {}` or `onClick=Bump() {}` now parses on a user tile and on a value builtin that reads its content from a positional argument, such as `link`, and binds the reducer as `onClick=Bump` does.

language.md says `onClick=Bump`, `onClick=Bump()` and `onClick=Bump {}` are one node after parsing. That held on the builtins that do not read a positional argument as content — `image` and `icon` among them — where a capitalised handler parses as a tile call. On a value builtin that reads its content from a positional argument, and on a user tile, the handler parsed as an expression, which left the `{` unconsumed:

```
tile Btn = button(text="go")
tile Go  = Btn(onClick=Bump {})
# before: Parse error at 2:29: Expected op()), got op({)
# after:  ok, and a click runs Bump
```

On those tiles a capitalised handler with a `{` after its name, or after its parenthesised arguments, now takes the call form. One that carries nothing (`Bump {}`, `Bump() {}`) is the variant tag `Bump` is there, as `Bump()` already was, so all the spellings are one node on every tile. One that carries props or arguments (`onClick=Bump {x: 1}`, `onClick=Bump(1) {}`) is E0201 "must be a reducer name", reported once, as on a builtin; on these tiles it was a parse error. A handler written without braces is still an expression there, so `onClick=Bump(1)` and `onClick=Bump(1) + 1` stay E0201 as before.
