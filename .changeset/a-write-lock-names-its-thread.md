---
"@kumikijs/cli": patch
---

The write lock waits on a writer in another thread of the same process

A writer took over any write lock that named its own pid, on the grounds that
it held nothing itself, so the lock had to be one of its own failed releases.
But the worker threads of one process share its pid, and each thread loads its
own copy of the lock module. So a writer on one worker thread that met a lock
held by another worker thread removed that live lock and wrote at the same
time as it:

```
A in, lock = {"pid":357,"host":"vm","token":"90d90fac8dda35d7"}
B in, lock = {"pid":357,"host":"vm","token":"fe3602f156412186"}
B out
A out
A warning: kumiki left the write lock … in place: it could not be removed, or it is no longer the one this call created
```

The lock now records the writing thread (`threadId`, `0` for the main thread)
next to the pid and host. Only a lock naming this pid and this thread is taken
over as a leftover. A lock naming another thread of this process is waited on
like any running writer's, and the wait-out message names the thread. A lock
written without a thread, by an earlier kumiki, names the main thread, and a
thread id that is not a non-negative integer (`null` included) names no writer.

Whether a thread is still running cannot be asked from another thread, so a
lock left by a worker thread that ended mid-write (a `terminate()` while it
held the lock) is waited on until its process exits. The wait-out message for
such a lock says to delete the lock file if that thread is not writing it.

The CLI and the MCP server write on the main thread only. This reached a host
calling `addDef`, `replaceDef` and the other exported verbs from worker
threads. The temp file each write is renamed from is now named for the thread
too.
