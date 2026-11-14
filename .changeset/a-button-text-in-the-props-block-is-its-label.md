---
"@kumikijs/compiler": patch
---

A `button`'s `text` written in the props block is its label, as `text=` is: `button() {text: "Go"}` renders a button that says `Go`.

A named argument and a `{ … }` entry of the same name are one prop on every builtin, and `toast() {text: "T"}` already showed its text. `button` read its label from `text=` alone, so the block's `text` passed `check` and the button rendered empty:

```
tile App = column(button() {text: "Go"}, toast() {text: "T"})
# before: <button data-kumiki-tile="button"></button>, and the toast shows "T"
# after:  <button data-kumiki-tile="button">Go</button>, and the toast shows "T"
```

When a call writes both, the block's value is the label, as for every other prop: `button(text="A") {text: "B"}` says `B`. The checker reads the label the same way, so `--strict-a11y` counts a block `text` as the button's name (E0701), and an `EffectId` written there is refused as it is under `text=`.
