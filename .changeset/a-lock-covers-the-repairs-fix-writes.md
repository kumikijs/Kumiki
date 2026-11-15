---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

An ownership lock covers the repairs `fix` writes

`kumiki fix --apply` wrote its repairs without reading `<file>.kumiki-locks.json`,
so it rewrote a definition another agent held — the one write path the lock
did not cover. With `slot.count`, `reducer.inc` and the rest locked by
`agent:a`, a `replace` from `agent:b` was refused and the same agent's
`fix --apply` was not:

```
$ KUMIKI_AUTHOR=agent:b kumiki replace c.kumiki slot.count 'Int = 1'
Error: lock violation: slot.count is locked by agent:a (pattern "*"). Set KUMIKI_AUTHOR=agent:a to edit.
$ KUMIKI_AUTHOR=agent:b kumiki fix c.kumiki --apply
applied 1 fix(es) — file now clean
```

`fix --auto-patch --apply`, and the MCP tools `kumiki_fix` and
`kumiki_auto_patch` with `apply`, wrote the same way.

A repair is now checked as every write verb's op is, by the same check: the
file is compared with the source the repair would write, and a definition it
adds, removes or changes that another agent holds refuses it before anything
is written. The file is left byte-identical, `fix` exits `1`, and the message
the write verbs give is printed on stderr, as they print it:

```
$ KUMIKI_AUTHOR=agent:b kumiki fix c.kumiki --apply
(auto-patch rolled back — a definition it changes is locked by another agent)
lock violation: reducer.inc is locked by agent:a (pattern "*"). Set KUMIKI_AUTHOR=agent:a to edit.
error E0103 undef-ref at 2:43: Reference to undefined name "cout"
```

The lock is asked before the regression gate, so a repair both would refuse is
refused as `locked`, and one the lock refuses is neither re-checked nor run
against the tests.

`fix` also takes the file's write lock to write a repair, as the write verbs
do, and reads the file again under it. A file another writer changed since the
repair was planned is left as it is: `fix` writes nothing and exits `1`, saying
that the file changed since the repair was planned (`writeError` on the MCP
tools), where it used to overwrite that writer's edit.

The refusal is reported where `fix` reports the regression gate's, as
`blocked` with `reason: "locked"` and that `message`: on `applyFixPlan`'s
result, on `kumiki_fix`'s apply result (flagged `isError`), and on
`kumiki_auto_patch`'s `compile-blocked` or `test-blocked` outcome. A
`--auto-patch` run whose compile repair was allowed and whose behavioural patch
was refused keeps the compile repair and reports it in `compileFixes`, as for
any refusal of that patch. The lock's owner, and a repair that changes no
locked definition, apply as before.

`kumiki_fix`'s apply result now carries `blocked` for the regression gate's
refusals too, in the shape `kumiki_auto_patch` already used.
