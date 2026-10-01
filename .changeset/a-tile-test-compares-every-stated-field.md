---
"@kumikijs/runtime": patch
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

A `tile-test` compares every content field its expected node carries, not only `kind`, `text` and `children` (`testing.md` §8.4). That covers the fields a builtin lifts (`src`, `to`, `value`, `checked`, `options`, …) and every other named argument the expected node is written with (`alt`, `disabled`, `variant`, `aria-*`, `id`, …).

```kumiki
tile Pic = image(src="/real.png")

test pic-src =
    tile-test Pic
        given  = {slots: {}}
        expect = image(src="/WRONG.png")
```

This test passed. So did a `link` with the wrong `to`, a `check` with the wrong checked state, an `input` with the wrong `value`, an `image` with the wrong `alt` and `button(text="Go", disabled=true)` against an enabled button. The snapshot never looked at those fields, and the report could not show them. They now fail with the field's path and the value arrow:

```
FAIL  pic-src
  expected: image(src="/WRONG.png")
  actual:   image(src="/real.png")
  diff at:  image.src  "/WRONG.png" -> "/real.png"
```

The `expected:` and `actual:` lines print only the compared fields, on both sides.

Some things stay out of the comparison: the `{…}` block (styles, classes and any prop written there, which the compiler now leaves out of a tile-test's expected tree), handlers, a node's `key`, a control's `bind` wiring, a link's `prefetch`, and any field the expected node does not carry. A builtin's default for an argument left out *is* carried. `check()` is an unchecked check and a `select` with no `options=` has none; §8.4 lists every such default.

`kumiki fix --auto-patch` proposes a literal repair for a tile-test only when the failing field is text. A `checked` state or an `options` list is often decided by `given.slots`, so rewriting the slot's initial literal could not make the test pass.
