---
"@kumikijs/compiler": patch
---

A prop written in the `{…}` block renders as the same prop written as a named argument

A named argument and a `{…}` entry of the same name are one prop, but the
props a builtin lifts onto its own node were read from the arguments only. In
the block they reached the props bag, which their renderers do not read, so
the element rendered the default and `kumiki check` said ok:

```kumiki
modal(text("inside modal")) {open: false}
select(bind=pick) {options: [{label: "Apple", value: "a"}, {label: "Pear", value: "p"}]}
list(text("one"), text("two")) {ordered: true}
```

rendered an open modal, a select with no options and a `<ul>`, where the
argument spelling renders a closed modal, two options and an `<ol>`. The same
held for every prop the lowering lifts: `open` on `drawer`, `popover` and
`details`; `title`, `side` and `placement` on the overlays; `text`, `kind` and
`placement` on `tooltip` / `toast`; `type` on `button`; `bind`, `value`,
`placeholder`, `type`, `required`, `auto-focus`, `accept`, `multiple` and
`rows` on the form controls; `value` / `selected` / `group` on `check`,
`switch` and `radio`; `min`, `max` and `step` on `slider`; `value` and `max`
on `progress`; `to` on `link`; `lang` on `code`; `src`, `controls` and
`autoplay` on `video`; `colspan` / `rowspan` on `table-cell`; `summary` on
`details`; and `field` on `error`. `packages/examples/features/34-builtin-tiles`
wrote `list(…) {ordered: true}` and rendered a `<ul>`.

Now each of them is read from either spelling through one lookup, the one the
props bag and the checker already used, and when a call writes both the
block's value is the one read. The checker rules about these props ask the
same lookup, so they judge what renders: `radio(bind=b) {value: V}` is no
longer E0225, `input(bind=n) {type: "number"}` no longer E0226, and a block
`{type: "submmit"}` on a button, `{bind: …}` on a file input and
`{accept: …}` on a text input are E0201, E0205 and E0206 as their argument
spellings are. A tile-test's `expect` tree still compares no block
(testing.md §8.4).
