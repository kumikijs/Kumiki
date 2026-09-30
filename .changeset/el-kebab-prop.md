---
"@kumikijs/compiler": patch
---

A kebab-case prop reaches a reducer's `$el` under the name the tile declared it with: `{item-name: $1}` (or `button(item-name=$1)`) is read back by `$el.item-name` (language.md §1.6.5).

The `$el` payload keyed each prop the way names the runtime defines are keyed, with `-` rewritten to `_`, while `$el.item-name` read the source spelling. The reducer read `undefined`, and the slot it wrote dropped out of the state. The payload's keys and every field read now come from one encoding, the source spelling, the one records already used.
