---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

A lock file that is not the shape `lock` writes is refused by name, instead of being misread

The ownership lock file `<file>.kumiki-locks.json` was used as found. A
hand-edited `"patterns": "slot.*"`, one string rather than a list of one, was
read a character at a time, and its `*` locked every definition. The refusal
named a pattern nobody had locked:

```
$ cat c.kumiki.kumiki-locks.json
{"entries":[{"agent":"agent:a","patterns":"slot.*"}]}
$ KUMIKI_AUTHOR=agent:b kumiki replace c.kumiki tile.Zed 'text("z")'
Error: lock violation: tile.Zed is locked by agent:a (pattern "*"). Set KUMIKI_AUTHOR=agent:a to edit.
$ kumiki unlock c.kumiki agent:a
unlocked agent:a                                 # exit 0, lock file rewritten
```

Other shapes failed with a raw `TypeError` (`e.patterns is not iterable` for an
entry without `patterns`, `pattern.split is not a function` for a pattern that
is not text), a raw `SyntaxError` for a file that is not JSON, or a misread
table: an entry without `agent` was held by `undefined`, and a top-level `[]`
counted as no locks for every op while `lock` and `unlock` threw.

Every reader of the lock file now checks it first: `add`, `replace`, `remove`,
`rename`, `edit`, `patch apply`, `patch revert`, `lock`, `unlock`, and the MCP
tools `kumiki_add`, `kumiki_replace`, `kumiki_remove`, `kumiki_rename` and
`kumiki_edit`. A file that is not JSON, or not
`{"entries": [{"agent": <text>, "patterns": [<text>, …]}]}`, is refused with
exit `1` (an `{"error": …}` envelope with `isError` in MCP). The source file and
the lock file are left as they were, and the message names the lock file and
the first field that is wrong:

```
$ KUMIKI_AUTHOR=agent:b kumiki replace c.kumiki tile.Zed 'text("z")'
Error: Lock file "/work/c.kumiki.kumiki-locks.json" is unreadable: entries[0].patterns is not a list. Fix it to the shape `lock` writes, {"entries": [{"agent": "agent:a", "patterns": ["slot.*"]}]}, or delete it to release every lock.
```

A missing lock file still means no locks, and a lock file in the shape `lock`
writes behaves as before. That includes an empty `entries` list, fields `lock`
does not write (ignored, and kept when `lock` or `unlock` rewrites the file),
and an entry whose `patterns` is an empty list, which earlier versions of
`lock` wrote for a pattern of only commas: it locks nothing, and `unlock`
releases it.
