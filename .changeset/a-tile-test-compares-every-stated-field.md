---
"@kumikijs/runtime": patch
---

A `tile-test` compares every content field its expected node carries — `src`, `to`, `value`, `checked`, `options`, … — not only `kind`, `text` and `children` (`testing.md` §8.4).

```kumiki
tile Pic = image(src="/real.png")

test pic-src =
    tile-test Pic
        given  = {slots: {}}
        expect = image(src="/WRONG.png")
```

passed, and so did a `link` with the wrong `to`, a `check` with the wrong checked state and an `input` with the wrong `value`: the snapshot never looked at those fields, and the report could not show them. They now fail with the field's path and the value arrow:

```
FAIL  pic-src
  expected: image(src="/WRONG.png")
  actual:   image(src="/real.png")
  diff at:  image.src  "/WRONG.png" -> "/real.png"
```

What stays out of the comparison is what §8.4 names — class names and styles — and any field the expected node does not carry. A default a builtin fills in for an argument left out is carried: `check()` is an unchecked check, and a `select` with no `options=` has none.
