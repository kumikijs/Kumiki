---
"@kumikijs/compiler": minor
---

Rendering an `EffectId` is **E0204 `effect-id-misuse`**

errors.md quoted `text(...) cannot render EffectId — it is an opaque handle`,
and nothing emitted it: only the operator half of E0204 was implemented. So

```
slot h : EffectId = EffectId.none
reducer go on=ui.click(Go) do= h := emit toast({kind: "info", text: "x", duration: None})
tile Go = button(text="go") {id: "go"}
tile P = column(Go, text(h), heading(h), text(h.show))
```

checked `ok`, and after the emit the page showed the runtime's internal
`<effect>:<key>` string. Now each rendering is refused:

```
E0204 effect-id-misuse at 4:26: text(...) cannot render EffectId — it is an opaque handle
E0204 effect-id-misuse at 4:38: heading(...) cannot render EffectId — it is an opaque handle
E0204 effect-id-misuse at 4:47: .show cannot render EffectId — it is an opaque handle
```

A value whose type is `EffectId`, through an alias or a `nominal` too, is
refused where it becomes text:

- the content of every value builtin — `text`, `heading`, `markdown`, `code`,
  `label`, `link`, `editable`, and `image` / `icon`, whose content is `src=` /
  `name=` — read off the table the lowering reads content from;
- every argument of `fmt(...)`, the template included;
- `show` in each spelling: `h.show`, `h.show()`, and `T.show(h)` whatever `T`
  is. `show` was the one member every value had, and an `EffectId` no longer
  has it (stdlib §2.1.1.1, §2.2.7).

The documented message names the builtin that renders the handle —
`<builtin>(...) cannot render EffectId — it is an opaque handle` — and `show`
has its own: `.show cannot render EffectId — it is an opaque handle`. A sum that
already drew the operator's E0204, such as `text("id " + h)`, is still one
report. An operator on an alias of `EffectId` is now E0204 as on `EffectId`
itself: with `type Handle = EffectId`, `x + "a"` checked `ok` and `x < x` was
E0201.

What stops checking is a program that renders a handle. Render what comparing
it with the sentinel answers instead — `text(if h == EffectId.none then "idle"
else "loading")`, or `(h != EffectId.none).show`. `features/209-effect-id-opaque`
does both. `features/116-emit-id-after-key-write` showed its id with
`text(lastId.show)`; it no longer does, and its scenario still pins the id
through slot state.

A `List(EffectId)` rendered whole, or joined with `.join(…)`, still shows each
handle. errors.md records it as a known gap.
