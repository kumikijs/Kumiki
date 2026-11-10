---
"@kumikijs/runtime": patch
---

A served `select` marks its slot's option `selected` when the options are variants or records

`renderToString` marked an `<option>` `selected` when its value was the very
object the slot held (`o.value === node.value`). A variant or a record option
never is, so for `type Size = S | M | L` bound to a slot holding `M`, no option
was marked and the page showed its first option until hydration, next to text
that already read `M`. Each option's `value` was `String(o.value)`:

```html
<select data-kumiki-tile="select" data-kumiki-bind="size">
  <option value="[object Object]">Small</option>
  <option value="[object Object]">Medium</option>
  <option value="[object Object]">Large</option>
</select>
```

The server now keys each option with the same structural key the mounted
`<select>` uses, and it is one function on both paths. That key is the option's
`value`, and the option whose key is the slot's carries `selected`:

```html
<option value="S">Small</option><option value="M" selected>Medium</option>…
```

`Some(Backlog)` and `Some(InProgress)` are told apart by their payload, as on
the client. A record option is matched by its JSON text, fields in the order
written, so a record whose fields are written in another order matches nothing
on either path (#941). The placeholder option is served `selected` by the
client's rule, when the select has no value, so a `Unit` value now selects it
on the server too.

A `Text` option's served `value` is now its key as well, `"m"` with the quotes
where it was `m`, the same as the mounted option's.

Under happy-dom (`kumiki smoke`, `kumiki run`), a mounted `select` whose slot's
option is third or later now holds that option. It held the second one, because
happy-dom loses the selectedness of an option inserted already selected; the
runtime now selects each option after inserting it.
