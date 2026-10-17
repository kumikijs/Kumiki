---
"@kumikijs/runtime": patch
---

Serve a `select` with its slot's option selected when the options are variants or records

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

`Some(Backlog)` and `Some(InProgress)` are told apart by their payload, and a
record option is selected by its fields, as on the client. The placeholder
option is still served `selected` only when the select has no value.

One consequence for a form posted before hydration: a `Text` option's served
`value` is now its key as well, `"m"` with the quotes, where it was `m`. That is
what the hydrated page already sent, so a server reading the field gets the same
string whether or not the page's script had run.
