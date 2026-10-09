---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

`lock` and `unlock` refuse a `.kumiki` file that does not exist, and every verb names the missing path

`kumiki lock` never checked that its source file existed. A mistyped path
exited `0` and wrote a lock file beside a file that was not there, so the agent
believed it held a lock while edits to the real file stayed unprotected:

```
$ kumiki lock missing.kumiki agent:a 'slot.*'
locked slot.* for agent:a                       # exit 0, missing.kumiki.kumiki-locks.json written
$ kumiki unlock missing.kumiki agent:a
Error: nothing to unlock: agent:a holds no lock on /work/missing.kumiki. No agent holds one.
```

The other verbs failed on a missing file with a bare `Error: ENOENT: no such
file or directory, open '…'`, except `view --history`, which already said
`File "…" not found`, and `patch revert`, which said the op-id was not in the
log. `kumiki dev` started serving a file that did not exist.

Every verb that takes a `.kumiki` file now looks for it once its arguments have
the right shape, before it reads or writes anything else. When nothing is
there it exits `1` with one message naming the path, resolved against the
working directory, and writes nothing beside it:

```
$ kumiki lock missing.kumiki agent:a 'slot.*'
File "/work/missing.kumiki" not found           # exit 1, no lock file
$ kumiki replace missing.kumiki slot.x 'Int = 1'
File "/work/missing.kumiki" not found           # exit 1
```

That covers `lock`, `unlock`, `add`, `replace`, `remove`, `rename`, `edit`,
`patch apply`, `patch revert`, `fix`, `check`, `list`, `view`, `refs`, `build`,
`smoke`, `test`, `run`, `replay` and `dev`. An argument of the wrong shape
still exits `2` first. On a file that exists, every verb behaves as before.

The rule is one function, `requireSourceFile`, now exported. `lockDef`,
`unlockDef`, `addDef`, `replaceDef`, `removeDef`, `renameDef`, `editDef`,
`patchApplyFile` and `patchRevert` throw its error for a missing file, so
`lockDef` writes no lock file there either. The MCP tools that take a `path`
answer a missing file with the same message in their `{"error": …}` envelope,
where most of them gave the `ENOENT` text.
