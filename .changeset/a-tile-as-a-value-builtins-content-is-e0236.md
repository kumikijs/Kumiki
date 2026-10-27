---
"@kumikijs/compiler": patch
---

A tile written as a value builtin's content — `text`, `heading`, `markdown`, `code`, `label`, `link`, `editable`, `image`, `icon` — is E0236 `tile-as-content`, at the tile, with two fixes: write the tile as a child of a container, or show a value.

A value builtin shows its content as a value, so a tile there never renders. A `when` or a `for` there passed `check` and lowered to `_s.show(undefined)`:

```
tile App = column(text(when(true, column(text("inner")))))
# before: ok, and `kumiki smoke` reports "root is empty after mount"
# after:  E0236 1:24 A tile is not a value: text shows a value as its content, so this tile is never rendered. Write the tile as a child of a container — `column(when(c, …))` — or show a value — `text(x.show)`
```

The name of a tile the program defines passed too, and showed the name as a variant tag; a builtin's call was looked up as a `fn`, once per call inside it:

```
tile Header = text("header")
tile App = column(text(Header), heading(column(text("a"))))
# before: E0116 Call to undefined function "text"
#         E0116 Call to undefined function "column"
#         (and `text(Header)` shows the word "Header")
# after:  E0236 at `Header`, E0236 at `column`
```

A tile in an arm of a value `if` / `match` — `text(if c then Header else "b")`, `text(match m with | A -> column(…) | B -> text(…))` — is E0236 at each tile arm, where it was E0116 per builtin call or nothing for a tile's name. A lower-cased tile's name, `text(lower)`, is E0236 where it was E0103. Nothing else in the content is checked once it holds a tile, so a diagnostic inside it shows once it is moved.

A value stays a value: a value `if` / `match` (`text(match m with | A -> "a" | B -> "b")`), a slot, loop variable or `match` binding named like a tile, a `fn` named like a builtin (`heading(label(x))`), a capitalised name a union has as a tag, and a builtin's name without its call (`text(code)`, still E0103).
