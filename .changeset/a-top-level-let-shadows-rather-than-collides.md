---
"@kumikijs/compiler": patch
---

Let a reducer's top-level `let` shadow the name it takes

A `let` at the top level of a reducer body lowered to a `const` in the same JS
block as the trigger's binds and the positional-binding declarations, so a
`let` that took a name already declared there emitted a second declaration of
it:

```kumiki
reducer boot on=app.start do= let $route = "x"
                              seen := $route
```

`check` and `build` were both clean, and the module then threw
`SyntaxError: Identifier '_d_route' has already been declared` at load — so
nothing rendered at all. A `let` over one of the trigger's own binds
(`on=ping.ok(p, _)` / `let p = …`) and a `let` repeating an earlier `let`'s
name failed the same way.

The language's answer to a name written twice is that the inner binding
shadows the outer one, which is what `errors.md` already promised for E0119
("a name an enclosing `let` or pattern binds is that binding, not the
payload") and what the nested forms — `for`, match arms — already did. Codegen
now gives a declaration over a name already in scope an identifier of its own,
and every read resolves through the scope that declared it, so the shadow
holds in the one place the language's nesting does not reach. The rule is
written down as [Language §1.6.7](https://kumiki.dev/spec/language#_1-6-7-scoping-and-shadowing).

A declaration's right-hand side is generated before the name enters scope, so
`let n = n + 1` reads the binding it shadows. That also fixes the expression
form, where `let $m = $m + "!" in $m` used to throw
`ReferenceError: Cannot access '_d_m' before initialization`: the shadow was
declared inside the same closure that evaluated its own value.
