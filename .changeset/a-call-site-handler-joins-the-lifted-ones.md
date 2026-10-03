---
"@kumikijs/compiler": minor
---

A handler written on a user-tile call site now joins the handlers already on the nodes that tile renders, instead of overriding them (#407). This changes what runs:

- `row(Btn {onClick: btnOwn})` with `reducer rowClick on=ui.click(Row)` ran `btnOwn` alone. Codegen lifted both reducers onto the button, then spread the call site's props over the finished node, and `{...node.props, ...props}` replaced the lifted `onClick` with the call site's. `check` said ok and `rowClick` never ran. Both run now.
- A call-site handler no longer overrides one the tile's body writes itself. With `tile Btn = button(text="x", onClick=dflt)` and `Btn {onClick: custom}`, `custom` used to replace `dflt`; now both run. A program that relied on the override has to drop the body's handler or pick another tile.
- Every reducer on one handler runs once, in definition order (language.md §1.6.4 Invariant 3), wherever it was wired. `propsFor` used to put a handler written on the element before the lifted ones; that rule is gone, so where a handler is written no longer decides what runs first.

A call site's handlers are handed down to the nodes its tile renders at its root — through nested call sites, into every branch of an `if` / `when` / `match`, and onto each node a `for` renders — and each node's `propsFor` joins them with its own handlers and the lifted subscriptions into one memoised `_h(...)`, so handler identity stays stable across renders. Only data props are left for `_attachProps` to merge.

A tile whose body is a `for` renders again. `_attachProps` merged the call site's props into the list itself, even when there were none, and produced an object of its indices with no `kind`, which the runtime has no renderer for. It merges onto each node of a list now, and leaves a node alone when there is nothing to merge.

Joining exposed an over-broad subscription in `02-todomvc` and the four `size-comparison` scenarios: `reducer toggle on=ui.click(TodoRow)` reached every button in the row, so the delete button ran `toggle` before `remove`, and the archive button flipped `done`. `toggle` subscribes to a `TodoCheck` tile holding the checkbox alone now, and language.md §1.6.2 says to subscribe to the narrowest tile the event means.
