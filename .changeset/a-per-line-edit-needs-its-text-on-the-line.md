---
"@kumikijs/cli": patch
---

A per-line `edit` patch is rejected when its text is not on the line it names

A per-line patch, `{"body:N": "replace 'a' -> 'b'"}`, is the shape of the
auto-patch in ai-edit.md. When `a` was not on line N, for example because the
line had changed since the patch was made, `edit` replaced nothing. It still
wrote the file back unchanged, logged an `edit` op, printed `edited …` and
exited `0`. `patch apply` and the MCP `kumiki_edit` tool did the same, so an
agent that applied a stale auto-patch was told it had applied.

Such a patch is now rejected like a `{find, replace}` patch whose `find` is not
in the definition: it exits `1` (`isError: true` over MCP), the file is left
byte-identical, no op is logged, and the message names the text and the line:

```
Error: edit rejected: "cuont" not present on body line 2 of reducer.reset
```

A text that is in the definition but on another line is rejected too. The
`{find, replace}` message now names the missing text the same way
(`"cuont" not present in reducer.reset`) instead of saying `"find" pattern`.
A per-line patch whose text is on its line applies as before.
