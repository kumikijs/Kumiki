---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

Concurrent write verbs on one file no longer lose each other's edits

Every mutation read the `.kumiki` file, wrote it back, re-read it to validate,
and rolled back to its own snapshot on failure, with no lock. Of eight `add`s
started at the same instant, all eight printed an op-id and logged an op, but
only two of the definitions reached the file. In another run, two valid adds
were rejected with a parse error, because `validate` had read a file another
writer was halfway through writing.

Write verbs now take a per-file write lock, a sibling
`<file>.kumiki-write.lock`, for the whole read → validate → write → log
sequence. `patch apply` and `patch revert` hold it once across the ops they
are made of. The composed source is validated before it is written, so a
rejected op never overwrites anything, and an op whose log entry cannot be
appended puts the file back. A writer that finds the lock held waits for it,
30 s by default or `KUMIKI_WRITE_LOCK_WAIT_MS`; if it is not released in time,
the op is rejected with exit `1`, nothing is written or logged, and the
message names the holder and the lock file. A lock left by a process on this
host that has exited, or one that names no holder and is over 2 s old, is
taken over; a lock naming a process on another host never is, and has to be
deleted by hand if that process is gone.

The MCP tools call the same mutators, so they wait the same way — and while a
tool call waits, the MCP server answers no other request, for up to the same
30 s.

Every write verb (and `kumiki fix`, which already did) now replaces the file
with a renamed sibling instead of writing it in place, so a reader never sees
a half-written file. A symlink at the file's path is replaced rather than
followed, and the file does not keep its own permissions. `kumiki fix --apply`
does not take the write lock.
