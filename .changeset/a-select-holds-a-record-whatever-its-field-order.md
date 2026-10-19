---
"@kumikijs/runtime": patch
---

A `select` holds a record option whatever order its fields are written in

A `select` matches its slot's option by a key, and a record was keyed by its
JSON text, which lists the fields in the order they were written. So for
`type Dims = {w: Int, h: Int}`, a slot holding `{h=3, w=2}` matched no option
written `{w=2, h=3}`, although `dims == {w=2, h=3}` is `true`. The mounted
`select` showed its first option, and the served one marked none `selected`:

```html
<option value="{&quot;w&quot;:1,&quot;h&quot;:1}">1 x 1</option>
<option value="{&quot;w&quot;:2,&quot;h&quot;:3}">2 x 3</option>
```

A record is now keyed with its fields in sorted order, at any depth and inside
a variant's payload, the same text a `Map` key is stored under. Two values `==`
calls equal have one key, so the slot holds "2 x 3" on both paths:

```html
<option value="{&quot;h&quot;:1,&quot;w&quot;:1}">1 x 1</option>
<option value="{&quot;h&quot;:3,&quot;w&quot;:2}" selected>2 x 3</option>
```

A record option's `value` attribute now lists its fields in sorted order. A
`Text`, a number and a variant keep the key they had.
