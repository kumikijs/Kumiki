---
"@kumikijs/compiler": patch
---

Take a user tile's input from the positional argument the checker counts

`checkTileInput` counts the positional arguments; codegen took `args[0]`,
whatever its name. So a named argument written first was consumed as the
tile's `$1`:

```kumiki
tile Btn = button(text="go")
tile App = column(Btn(onClick=bump), text(n.show))
```

`check` reported ok — a call with no positional argument to a tile that wants
none is correct — while codegen bound `$1` to the handler and emitted a bare
`bump` that nothing declares. The mount died in render with
`bump is not defined`. A tile that *does* declare `in=` failed the same way and
lost its input as well: `Row(onClick=tap, label)` passed the handler as `$1`
and dropped `label`.

The two halves read the same set now. What a named argument means is
unchanged, and it is not an input: it is a prop, merged onto the node the tile
renders, so `Btn(onClick=tap)` and `Btn() {onClick: tap}` are one wiring.
Whether it fires is a question about what the tile renders, which is W0213's.
