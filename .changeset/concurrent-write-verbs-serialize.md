---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

Concurrent write verbs on one file no longer lose each other's edits

Every mutation read the `.kumiki` file, wrote it back, re-read it to validate,
and rolled back to its own snapshot on failure, with no lock. Eight `add`s
started at the same instant all printed an op-id and all logged an op, but only
some of the definitions reached the file:

```
ops logged: 8
slots in file: 2   (extra2, extra7)
```

In another run, two valid adds were rejected with a parse error, because
`validate` had read a file another writer was halfway through writing.

Write verbs now take a per-file write lock, a sibling
`<file>.kumiki-write.lock`, for the whole read → validate → write → log
sequence. `patch apply` and `patch revert` hold it once across the ops they
are made of. The composed source is validated before it is written and is
written by rename, so a reader never sees a partial file and a rejected op
never overwrites anything. A writer that finds the lock held waits for it. If
the lock is not released in time, the op is rejected with exit `1`, and
nothing is written or logged. A lock left behind by a process that has exited
is taken over. The eight-writer race now ends with all eight slots in the file
and eight ops in the log. The MCP tools call the same mutators, so the same
applies to them.
