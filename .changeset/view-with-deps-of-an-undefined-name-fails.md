---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

`view --with-deps` of a name that is not defined fails, as `view` does

`kumiki view` reported a qualified name the file does not define as an error and
exited `1`, as §9.2.5 asks. With `--with-deps` the same name printed an empty
line and exited `0`, so a typo read as a definition with nothing in it:

```
$ kumiki view c.kumiki slot.nope --with-deps; echo exit=$?

exit=0
```

It now gives the same answer as without the flag:

```
$ kumiki view c.kumiki slot.nope --with-deps; echo exit=$?
Definition "slot.nope" not found
exit=1
```

The MCP `kumiki_view` tool with `withDeps: true` returned empty text without
`isError`. It now returns the `{"error": {"kind", "message"}}` envelope with
`isError: true`, as it does without `withDeps`.

Both ask `viewWithDeps`, which now returns `null` for a name that is not
defined, the same answer `viewDef` gives. Its return type, exported from
`@kumikijs/cli`, is `string | null` instead of `string`. A name that is defined
prints as before.
