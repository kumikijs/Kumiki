---
"@kumikijs/runtime": patch
---

A served `radio` whose value is a variant or a record carries that value's structural key, where it carried `[object Object]`

`renderToString` served a radio's `value` as `String(value)`. For a variant or
a record that is `[object Object]`, so every radio of a group bound to
`type Size = S | M | L` was served the same:

```html
<input type="radio" name="size" value="[object Object]">
```

The mounted radio wrote no `value` at all, so the two paths disagreed. A radio
now carries the structural key a `select` gives an option, and it is the same
function on both paths. The served page reads as follows, and each mounted
radio carries the same `value`:

```html
<input type="radio" name="size" value="S">
<input type="radio" name="size" value="M" checked>
```

`Some(Backlog)` is served as `Some|Backlog`, apart from `Some(InProgress)`, and
a record as its JSON text. A `Text` radio's value is its key as well, `"pro"`
with the quotes where it was `pro`, the same as a served option's. A radio
with no `value=` carries no `value` on either path. Which radio is checked,
and what choosing one writes, are unchanged: a bound radio still writes the
value itself, not the key.
