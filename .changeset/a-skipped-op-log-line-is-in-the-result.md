---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

A torn op-log line that was skipped is reported in the result, not only on stderr

A last line of `<file>.kumiki-ops.jsonl` that has no newline after it and is
not valid JSON is skipped, and the reader said so only with a `console.warn`.
An MCP client sees the server's stdout transport, not its stderr, so
`kumiki_history` and the edit tools answered as if nothing had been skipped. A
library caller of `readOpLog` got the complete entries and nothing in the
return value saying a line was missing, while every read printed the warning
to its stderr unasked. `kumiki patch revert` reads the log twice, so it
printed the warning twice.

The MCP tools that read the log (`kumiki_history`, `kumiki_add`,
`kumiki_replace`, `kumiki_edit`, `kumiki_rename`, `kumiki_remove`) now follow
their answer with a second text block when the read skipped a line. The answer
itself is unchanged:

```
replaced slot.count  (op_…)
```

```json
{
  "warnings": [
    {
      "kind": "malformed-jsonl",
      "message": "/…/c.kumiki.kumiki-ops.jsonl:2: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it"
    }
  ]
}
```

In the library, `readOpLogResult(path)` returns `{ entries, skipped }`, where
`skipped` is `{ path, line }` or `null`; `readOpLog` still returns the entries
alone. Each verb that reads the log (`addDef`, `replaceDef`, `editDef`,
`renameDef`, `removeDef`, `patchApplyFile`, `patchRevert`, `viewHistory`) takes
an optional last argument `{ onSkipped }`, which is handed the skipped line
once, before the verb returns or throws. The library no longer prints
anything; `describeSkipped` gives the warning's text. The CLI prints the same
warning as before, once per verb.
