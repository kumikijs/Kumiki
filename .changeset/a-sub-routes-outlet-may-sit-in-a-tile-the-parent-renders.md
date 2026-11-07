---
"@kumikijs/compiler": patch
---

Accept a `sub-routes` parent whose `route-outlet` is in a tile it renders, and refuse one whose only outlet is never rendered

E0113 exists because a `sub-routes` parent with no outlet leaves the matched
child nowhere to render. It looked only at the parent's own body, never into a
tile the body names, so moving the outlet into a layout helper was refused:

```kumiki
tile NotFound = page(heading("404"))
tile AccountSettings = page(heading("Account settings"))
tile Outlet = column(route-outlet())
tile SettingsLayout
    sub-routes = { "/settings/account" -> AccountSettings }
    = page(heading("Settings"), Outlet)
app M caps=[] routes={"/settings/*" -> SettingsLayout, "/404" -> NotFound} init=[]
```

```
E0113 sub-routes-without-outlet at 4:1: Tile "SettingsLayout" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render
```

Yet code generation inlines `Outlet` into the parent's tree, and the runtime
fills the first `route-outlet` anywhere in that tree: lowered without the
checker, the program renders "Settings" with "Account settings" in the outlet.

E0113 now follows what code generation renders from the body, any number of
tiles down: a tile the body calls (`Outlet()`) or names (`Outlet`), the
branches of `for` / `when` / `if` / `match`, and the positional arguments of a
builtin that renders children, such as `column` or `card`. The program above
checks and renders its child. So does a parent whose body is the helper itself
(`= Outlet`), an outlet in a tile that takes an input, and one in a tile that
declares `sub-routes` of its own: inlined into the parent, its outlet shows the
parent's child. The message says where it looked:

```
Tile "SettingsLayout" declares sub-routes but renders no "route-outlet", in its body or in any tile it renders — the matched child would have nowhere to render
```

Two forms E0113 used to accept are refused now, because their outlet never
renders: an outlet passed positionally to a builtin that drops its positional
arguments (`spinner(route-outlet())`, `button(text="go", route-outlet())`), and
one in a tile written as a named argument (`column(x=when(c, route-outlet()))`).
Both compiled, and at runtime the child was discarded with a console error; the
check now reports them at compile time.
