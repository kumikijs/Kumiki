---
"@kumikijs/compiler": patch
---

A value builtin's content written in the props block renders, as its named argument does: `label() {text: "Name"}`, `image(alt="Logo") {src: "logo.png"}` and `icon() {name: "plus"}` show their text, image and icon.

`text=` on `label`, `link` and `editable`, `src=` on `image` and `name=` on `icon` are one argument with the block entry of that name, as a named argument and a block entry are one prop on every builtin. Before, only `link` read its block `text`, and the others rendered empty with nothing reported:

```
tile App = column(label() {text: "LBL"}, image(alt="a") {src: "a.png"}, icon() {name: "plus"})
# before: <label></label>, <img src="" alt="a">, an icon with no name
# after:  <label>LBL</label>, <img src="a.png" alt="a">, an icon named "plus"
```

When a call writes both, the block's value is the content, as for every prop, so `label(text="A") {text: "B"}` and `link(to="/", text="A") {text: "B"}` say `B`. A block `text` the builtin never reads is E0129, as `text=` there is: beside a positional argument on `label`, `link` or `editable` (`link("Home", to="/") {text: "X"}` used to show `Home` and drop `X` silently), and on `text`, `heading`, `markdown` or `code` with no positional argument. The checks that read content read the block entry too: an `EffectId` written there is refused, and `--strict-icons` reports an unknown icon name written there (E0704).
