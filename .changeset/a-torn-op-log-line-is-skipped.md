---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

A torn last line in the op log no longer blocks every write verb

Every write op reads `<file>.kumiki-ops.jsonl` for its parent op, and that
read parsed each line strictly. When the log ended in a line cut off
mid-write, every later `add` / `replace` / `edit` / `remove` / `rename` was
rejected with a bare JSON parse error
(`replace rejected: the op could not be logged (Unterminated string in JSON at position 34 …)`),
and `view --history` failed with `SyntaxError: Unterminated string in JSON …`.
Neither named the log or the line, and nothing could be edited until the log
was repaired by hand.

A last line that has no newline after it and is not valid JSON is now skipped
with a warning naming the log and the line, and the next op logged is written
in its place:

```
warning: /…/c.kumiki.kumiki-ops.jsonl:2: skipped the last line, which is not valid JSON and has no newline after it; the next op logged replaces it
replaced slot.count  (op_…)
```

`view --history` lists the complete entries. Any other line that is not an op
still fails the verb, but the error now names the log and the line
(`c.kumiki.kumiki-ops.jsonl:1: not valid JSON (…)`, or `not an op object` for
JSON such as `null`), and a write op is rejected with the file put back, as
before. A last entry with no newline after it no longer has the next entry
appended onto the same line. The MCP tools go through the same reader, so
`kumiki_history` and the edit tools behave the same way; the warning goes to
the server's stderr.

A write op cuts the torn line off before it appends its own line. If that
append fails, the file is put back and the rejection says the line was cut off:

```
replace rejected: the op could not be logged (ENOSPC: no space left on device, write; /…/c.kumiki.kumiki-ops.jsonl holds its complete entries, and its skipped last line was cut off); the file was restored
```

When cutting the log back after any failed append fails too, that error was
dropped and the op was reported as rejected with nothing written, although the
log's last line could still hold the op (and, whole but for its newline, be
read back as one). The op now fails, naming the log and both errors:

```
replace failed: the op could not be logged (ENOSPC: no space left on device, write; cutting /…/c.kumiki.kumiki-ops.jsonl back to its complete entries failed too (EIO: …), so its last line may hold part of this op); the file was restored
```
