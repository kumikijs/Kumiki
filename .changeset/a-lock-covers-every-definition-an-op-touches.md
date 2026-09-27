---
"@kumikijs/cli": patch
---

An ownership lock covers every definition an op touches

`enforceLock` was only given the name the verb was called with. As a result,
an agent whose direct `replace` or `remove` of a locked definition was refused
could still reach that definition another way:

- `remove slot.count --cascade` deleted every locked reducer and tile that
  depended on it.
- `rename slot.count todos` created `slot.todos` inside another agent's
  `slot.todos*` namespace.
- `rename slot.count total` rewrote the bodies of four locked referrers.

The check now covers each cascaded dependent, the new name of a rename and
each definition whose text a rename rewrites. It runs before anything is
written, so a locked definition anywhere in that set rejects the whole op: it
exits `1`, leaves the file byte-identical, and names the first locked
definition and its owner:

```
Error: lock violation: reducer.dec is locked by agent:a (pattern "reducer.*"). Set KUMIKI_AUTHOR=agent:a to edit.
```

`patch apply` and the MCP tools call the same mutators, so the same check
applies to them.
