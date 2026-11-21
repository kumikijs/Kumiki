---
"@kumikijs/compiler": patch
---

A data prop written where a user tile is called replaces only the prop it names

A call site's data props are merged onto the nodes the tile renders at its root
(language.md, "Event Handler props"). The merge was one level deep, so the `el`
payload a reducer reads as `$el` was replaced whole by the call site's. With

```kumiki
tile Ghost = button(text="Ghost", id="three")
reducer hitGhost on=ui.click(Ghost#three) do= log := log + "ghost;"
tile P = column(Ghost {variant: "ghost"}, text(log))
```

the button's `$el` was `{variant: "ghost"}`. The id the tile gave it was gone,
the runtime's `Tile#id` filter (language.md, "Selectors") dropped every click,
and `hitGhost` never ran, with `check` and `build` both clean. Any other field
the tile put in `$el` went the same way: a reducer reading `$el.todoId` from
`tile Del = button(text="Del") {todoId: 7}` read nothing once a call site wrote
any prop that reaches `$el`. The `aria` map was replaced the same way, so with
`tile Del = button(text="Del", aria-label="Delete")`,
`Del {aria-describedby: "hint"}` rendered the button without its `aria-label`.

Before, on the feature example `253-call-site-prop-keeps-id`:

```
$ kumiki run 253-call-site-prop-keeps-id.kumiki 253-call-site-prop-keeps-id.scenario.json
[ok] step 0 (nothing has run yet)
[ok] step 1 (the button Plain renders fires Plain#plain): click #plain
[FAIL] step 2 (Ghost's call site writes variant, not id, so its button keeps the id ghost and Ghost#ghost fires): click #ghost
    assert: state log: expected "plain;ghost;", got "plain;"
[FAIL] step 3 (Del's call site writes id x, which replaces del; the todoId Del wrote is still in $el): click #x
    assert: state log: expected "plain;ghost;x7;", got "plain;x;"
[FAIL] step 4 (Lab's call site writes aria-describedby, so its button keeps the aria-label Lab wrote beside it): click [aria-label="Delete"][aria-describedby="hint"]
    action failed: no element matching selector [aria-label="Delete"][aria-describedby="hint"]
    assert: state log: expected "plain;ghost;x7;lab;", got "plain;x;"
    assert: DOM should include "log: plain;ghost;x7;lab;"

scenario FAILED
```

After:

```
$ kumiki run 253-call-site-prop-keeps-id.kumiki 253-call-site-prop-keeps-id.scenario.json
[ok] step 0 (nothing has run yet)
[ok] step 1 (the button Plain renders fires Plain#plain): click #plain
[ok] step 2 (Ghost's call site writes variant, not id, so its button keeps the id ghost and Ghost#ghost fires): click #ghost
[ok] step 3 (Del's call site writes id x, which replaces del; the todoId Del wrote is still in $el): click #x
[ok] step 4 (Lab's call site writes aria-describedby, so its button keeps the aria-label Lab wrote beside it): click [aria-label="Delete"][aria-describedby="hint"]

scenario passed
```

The call-site merge now takes `el` and `aria` a field at a time: a prop the call
site writes replaces the one of that name, and every prop it does not write
stays as the tile wrote it, in the rendered element and in `$el` alike. A
call-site `id` (`Ghost {id: "x"}` or `Ghost(id="x")`) still replaces the tile's
id, so `ui.click(Ghost#x)` fires for it and `ui.click(Ghost#three)` does not.
Every user-tile call site goes through the one merge: a `for`-bodied tile, a
tile whose body is an `if` / `when` / `match`, a tile calling another, and the
server-rendered page alike.

E0212 (`--strict-selector-id`) reads ids the same way. Under a call site that
writes another prop and no `id`, it takes the id the tile wrote, so
`ui.click(Ghost#four)` under `Ghost {variant: "ghost"}` is reported where it
used to pass.
