---
"@kumikijs/compiler": patch
---

A handler written on a user-tile call site now joins the handlers already on the node that tile renders, instead of replacing them (#407).

`row(Btn {onClick: btnOwn})` with `reducer rowClick on=ui.click(Row)` ran `btnOwn` alone: codegen lifted both reducers onto the button, then spread the call site's props over the finished node, and `{...node.props, ...props}` replaced the lifted `onClick` with the call site's. `check` said ok and `rowClick` never ran. `02-todomvc`'s delete button was this exact shape.

A call site's explicit handlers are now handed down to the node its tile renders — through nested call sites and into every branch of an `if` / `when` / `match` — and that node's `propsFor` joins them with its own explicit handlers and the lifted subscriptions into one memoised `_h(...)`, so handler identity stays stable across renders. A body that renders a list (`for`) has no single node to take them and keeps the spread.

Every reducer on one handler now runs once, in definition order (language.md §1.6.4 Invariant 3), wherever it was wired. `propsFor` used to put explicit handlers first; that rule is gone, so where a handler is written no longer decides what runs first.
