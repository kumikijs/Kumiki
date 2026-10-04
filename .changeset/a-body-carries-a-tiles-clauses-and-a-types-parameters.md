---
"@kumikijs/cli": patch
"@kumikijs/mcp": patch
---

A body can state a tile's clauses and a type's parameters, and `replace` keeps the ones it does not state

`add` and `replace` built a definition as `tile <name> = <body>` or
`type <name> = <body>`, so no body could write what sits between the name and
the `=`: a tile's `in=`, `error-boundary=`, `scroll-restoration=` and
`sub-routes=`, or a type's parameters. Four things followed from that:

- `replace` of a tile with `error-boundary=` or `sub-routes=` wrote
  `tile <name> = <body>`. The clause was gone, `check` still said `ok`, and the
  verb exited 0.
- `add tile Greet 'in=Text = heading($1)'` and `add type Box '(T) = {v: T}'`
  were parse errors. The only way in was through the name
  (`add type 'Box(T)' '{v: T}'`), which logged the op as `type.Box(T)`.
- `edit` and `remove` logged the whole definition as the body of such a tile,
  so a `patch revert` that wrote it back failed with a parse error.
- `add` and `replace` rejected `test` and `motion` as `Unknown layer`,
  although `list`, `view`, `remove` and `rename` accept both. An unknown layer
  exited 1, after the file was read.

Now a body that starts with clauses or parameters states them, `=` included:

```
$ kumiki add t.kumiki tile Greet 'in=Text = heading($1)'
added tile.Greet  (op_…)                    # tile Greet in=Text = heading($1)
$ kumiki add t.kumiki type Box '(T) = {v: T}'
added type.Box  (op_…)                      # type Box(T) = {v: T}
```

A `replace` body that does not state them keeps the ones the definition has:
`replace tile.Greeting 'heading("Hello")'` on
`tile Greeting error-boundary=Oops = …` writes
`tile Greeting error-boundary=Oops = heading("Hello")`. A body that starts at
the `=` drops them. `replace` and MCP `kumiki_replace` print a
`  dropped <clause>` line (`  dropped parameter T` for a type) for each one the
definition no longer has.

`replace` and `edit` now record the body the definition had before the op, as
`prev` in the op log, and `patch revert` writes that back. The revert puts
back clauses that no logged body has, such as ones written by hand, and it
works on a definition that no op created, which failed before with
`no prior body found`. The op log records a tile or a type without clauses or
parameters from its `=` (`= heading("Hi")`), so `patch apply` and
`patch revert` read a logged body the same way. Reverting an op that an
earlier version logged with a whole definition as its body now says so,
instead of failing with a parse error.

`add` refuses a name that is not one identifier. `add`, `replace` and MCP
`kumiki_add` accept every kind of definition `list` shows, and `kumiki add`
exits `2` for any other layer, naming the allowed ones, before it reads the
file.
