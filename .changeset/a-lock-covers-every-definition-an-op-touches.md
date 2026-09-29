---
"@kumikijs/cli": patch
---

An ownership lock covers every definition an op touches

The lock was only checked against the name the verb was called with. As a
result, an agent whose direct `replace` or `remove` of a locked definition was
refused could still reach that definition another way:

- `remove slot.count --cascade` deleted every locked reducer and tile that
  depended on it.
- `rename slot.count todos` created `slot.todos` inside another agent's
  `slot.todos*` namespace.
- `rename slot.count total` rewrote the bodies of four locked referrers.
- A `replace`, `add` or `edit` body is written as given, so a body that went
  on to a second definition (`slot todosX : Int = 0`, `reducer inc2 …`)
  created it inside a locked namespace.

What an op touched is now read off the file rather than off the verb. After
the op's write passes validation, the definitions before and after it are
compared by qualified name, and every one that was added, removed or whose
text changed is checked against the lock table. A locked definition anywhere
in that set rejects the whole op: it exits `1`, the file is restored
byte-identical, no op is logged, and the message names the first locked
definition (in qualified-name order) and its owner:

```
Error: replace rejected: lock violation: slot.todosX is locked by agent:a (pattern "slot.todos*"). Set KUMIKI_AUTHOR=agent:a to edit.
```

`patch apply`, `patch revert` and the MCP tools call the same mutators, so the
same check applies to them.
