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

A value whose type is `EffectId`, through an alias, a `nominal` or a `let`
too, is refused in these places:

- the content of every value builtin: `text`, `heading`, `markdown`, `code`,
  `label`, `link`, `editable`, and `image` / `icon`, whose content is `src=` /
  `name=`;
- `button`'s `text=`, `link`'s `{text: …}` prop, and the value `editable`
  binds;
- every argument of `fmt(...)`, the template included;
- `show` in each spelling: `h.show`, `h.show()`, and `T.show(h)` whatever `T`
  is (stdlib.md).

The documented message names the builtin that renders the handle —
`<builtin>(...) cannot render EffectId — it is an opaque handle` — and `show`
has its own: `.show cannot render EffectId — it is an opaque handle`. An
operator applied to a handle, as in `text("id " + h)`, is still one report. An
operator on an alias of `EffectId` is now E0204 as on `EffectId` itself: with
`type Handle = EffectId`, `x + "a"` checked `ok` and `x < x` was E0201.

An `EffectId` has no member besides `show`, so `h.upper` and `h.length` are
now **E0108**, as a member of another type is. They checked `ok` and showed
the handle's text.

A `let … in …` now has its body's type wherever the checker infers one, so
`text(let x = h in x)` is refused like `text(h)`.

What stops checking is a program that renders a handle. Render what comparing
it with the sentinel answers instead: `text(if h == EffectId.none then "idle"
else "loading")`, or `(h != EffectId.none).show`.

Some places still show a handle and are not reported, as known gaps: a `List`
or a tuple with handles in it, rendered whole or joined with `.join(…)`; a
handle given to another named argument or prop that renders text, such as
`tooltip(…, text=h)` or `input(value=h)`; and `panic(h)`.
