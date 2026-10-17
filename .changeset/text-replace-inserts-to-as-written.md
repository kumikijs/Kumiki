---
"@kumikijs/compiler": patch
---

Insert `Text.replace`'s `to` as written

`Text.replace(from, to)` lowered to `String.prototype.replaceAll(from, to)` with
`to` as a string, which JavaScript reads as a replacement pattern: `$$` became
`$`, `$&` the matched text, and `` $` `` / `$'` the text before / after the
match. Kumiki has no such syntax, so a price, a currency template or text a
user typed into a slot came out altered, with `check`, `build` and `smoke` all
clean:

```kumiki
"cost: X".replace("X", "$$5")   # was "cost: $5"
"a-b".replace("-", "$&$&")      # was "a--b"
"one two".replace(" ", "$'")    # was "onetwotwo"
```

They are now `"cost: $$5"`, `"a$&$&b"` and `"one$'two"`, whether `to` is a
literal or a value read from a slot. The call still lowers to `replaceAll`, with
`to` handed over through an inline replacer function, so it is inserted as it
is; the runtime is unchanged. The receiver, `from` and `to` are each evaluated
once, in that order. Every occurrence of `from` is still replaced, and `from` is
still matched as plain text; an empty `from` still matches before each character
and at the end (`"abc".replace("", "-")` is `"-a-b-c-"`).

stdlib.md says so in both language tracks, and
`packages/examples/features/195-text-replace-verbatim.kumiki` renders each
pattern with a scenario that names the text it must show.
