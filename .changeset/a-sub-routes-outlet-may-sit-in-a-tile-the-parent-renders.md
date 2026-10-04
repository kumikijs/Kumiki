---
"@kumikijs/compiler": patch
---

Accept a `sub-routes` parent whose `route-outlet` is in a tile it renders

E0113 exists because a `sub-routes` parent with no outlet leaves the matched
child nowhere to render. It looked only at the parent's own body, never into a
tile the body names, so moving the outlet into a layout helper was refused:

```kumiki
tile Outlet = column(route-outlet())
tile SettingsLayout
    sub-routes = { "/settings/account" -> AccountSettings }
    = page(heading("Settings"), Outlet)
```

```
E0113 sub-routes-without-outlet at 4:1: Tile "SettingsLayout" declares sub-routes but its body never calls "route-outlet" — the matched child would have nowhere to render
```

Yet code generation inlines `Outlet` into the parent's tree, and the runtime
fills the first `route-outlet` anywhere in that tree: lowered without the
checker, the program renders "Settings" with "Account settings" in the outlet.

E0113 now follows the same expansion code generation inlines — the edges E0005
follows from a body: nested tile calls (`Outlet()`), an identifier standing in
for a tile (`Outlet`), and the branches of `for` / `when` / `if` / `match` — any
number of tiles down. The program above checks and renders its child. So does an
outlet in a tile that takes an input, and one in a tile that declares
`sub-routes` of its own: inlined into the parent, its outlet shows the parent's
child. A parent with no outlet anywhere in its expansion is still E0113, and
the message says where it looked:

```
Tile "SettingsLayout" declares sub-routes but renders no "route-outlet", in its body or in any tile the body expands into — the matched child would have nowhere to render
```

One form E0113 used to accept is refused now: an outlet written as a named
argument (`column(x=route-outlet())`). Nothing renders a tile in that position,
and the runtime discarded the child and logged it; the check now says so at
compile time instead.
