---
"@kumikijs/compiler": minor
---

Parse a tile argument as a value wherever a value belongs

The parser decided whether a tile argument was a value or a tile from two
hard-coded lists — the builtins whose positional argument is content, and
thirty-odd argument names (`text=`, `value=`, `to=`, …). Any other argument
took the tile path: an `if` / `match` became a `TileIf` / `TileMatch`, a call
named like a builtin became a tile call, and a capitalised head became a tile
call. So ordinary values failed to parse, or were typed as tiles:

```
column(button(text="Save", disabled=if busy then true else false))
  -> Parse error at 10:61: Expected ident, got kw(true)
column(radio(name="f", value="all", selected=All == filter))
  -> Parse error at 10:61: Expected op()), got op(==)
column(slider(bind=v, max=Int.parse(s).get-or(10)))
  -> Parse error at 10:41: Expected op()), got op(.)
column(Row(if busy then 100 else 1))
  -> Parse error at 10:36: Expected ident, got num(100)
column(Tab(if busy then Done else All))
  -> E0201 Tile "Tab" expects a value of type F but got a tile
column(Say(label("x")))
  -> E0201 Tile "Say" expects a value of type Text but got a tile
```

The decision is now the one the language spec states for tile arguments. A
tile argument is a tile only as a positional argument of a builtin other than
the value builtins (`column`, `row`, `box`, …) — the same rule E0128 checks.
Everywhere else it is a value: every named argument whatever it is called, a
value builtin's content, and a user tile's input. All six lines above check
clean and render the value they spell — `disabled` follows `busy`, `Row` shows
`n=1`, `Say` shows `x!` — and the argument-name list is gone.

The one shape kept from the old path is the event handler's: a capitalised
name written as an event handler of a builtin other than the value builtins is
a tile call, so `button(onClick=Bump)`, `Bump()` and `Bump {}`, and
`check(onChange=Bump {})`, bind the reducer as before. Any other named argument is a value on those
builtins too: `button(disabled=All == filter)` is a comparison, and
`button(variant=Primary)` passes the variant tag.

Consequences worth knowing before upgrading:

- A builtin tile's name called in a named argument is a function call, so
  `card(header=text("a"))` and `Btn(header=text("a"))` are E0116, reported by
  the position: `"text" is a tile, and a tile renders only as a positional
  argument of a builtin other than the value builtins`. Nothing renders a tile
  written as a named argument, and the first used to be dropped with nothing
  said. `button(onClick=divider())` is E0201 (`must be a reducer name`) rather
  than E0102.
- A capitalised name in a named argument that is not a handler is a variant
  tag on every tile, so `box(header=Inner)` passes the tag `Inner` where it
  used to call the tile `Inner` and drop it. A misspelt name there is no
  longer reported: `button(text="x", disabled=Zzz)` was E0105 and is now a tag
  that nothing checks, so the button stays enabled. A builtin's prop values
  are not type-checked yet (#545), and names that were on the old list, such
  as `title=Zzz`, were already unreported.
- A capitalised name followed by a props block, in a named argument that is not
  a handler, is a parse error: `box(text("x"), header=A {id: "y"})` was a tile
  call that was dropped with nothing said, and now fails with
  `Expected op()), got op({)`.
- A builtin tile's name called as a user tile's input is a function call too,
  so `Say(text("x"))` is the same E0116 rather than E0201.
- The positional arguments of a call to an undefined tile are not checked, as
  whether each is a tile or a value depends on the tile: `colum(text("a"))` is
  the one E0105.
