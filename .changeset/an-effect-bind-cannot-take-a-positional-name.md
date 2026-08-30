---
"@kumikijs/compiler": minor
---

Reject an effect bind named after a positional binding (E0121)

`on=ping.ok($el, _)` bound the payload's first positional to `$el`, which is
one of the three names the runtime fills in on every reducer application. The
emitted reducer then declared `const _d_el` twice, so the module threw
`SyntaxError: Identifier '_d_el' has already been declared` at load and the app
never rendered — with `check` and `build` both clean. `$event` and `$route`
were the same.

The bind is now **E0121 `reserved-bind-name`**, reported at the bind rather
than at the effect it follows or at a read in the body. `$route` reports this
and nothing else: the bind still enters the reducer's scope, so the body's
reads resolve to it rather than collecting an `E0119` apiece for a name the
author chose themselves.

Three names are reserved, not a prefix — `$1`, `$m` and `$now` stay bindable,
because nothing else declares one. Codegen emits its seeds from the same table
the checker reserves, so a name added to one side arrives on the other.
