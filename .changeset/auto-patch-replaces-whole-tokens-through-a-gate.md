---
"@kumikijs/cli": minor
"@kumikijs/mcp": minor
---

`fix --auto-patch --apply` replaces whole tokens only, and writes through a gate

The behavioural tier found the failing leaf's actual value with a plain
substring search, so a numeric `1` matched the `1` inside the tile name `Btn1`
or inside the threshold `10`, and `--apply` wrote that with nothing checking
the result:

```
$ kumiki fix ap.kumiki --auto-patch inc-adds-two --apply
Error: compile failed:
E0211 Reducer "inc" subscribes to ui.click(Btn2) but tile "Btn2" is not declared
```

A candidate is now a whole token, read from the lexer: the `1` in `Btn1`, in
`10`, inside a string or inside a comment is never one. In that program the
only token `1` is `fn step() -> Int = 1`, and replacing it makes the test pass.

The write is gated the way the compile tier's already was. The patched source
is parsed, typechecked and tested before it reaches disk, and it is written
only if it compiles, the named test passes and no test that passed before
fails. Otherwise the file is left byte-identical and the outcome is the new
`test-blocked` status, whose `blocked.reason` is `parse-error`, `introduced`
(with the diagnostics), `test-runner-threw`, `still-fails` (with the test's
result) or `regressed` (with the test names):

```
$ kumiki fix nc.kumiki --auto-patch set-to-one --apply
refused fix for "set-to-one" — file left unchanged:
  replace 5 with 1 (from failing test "set-to-one" @ slots.count)
  reason: introduced
  E0804 Refinement between(2, 1) has a lower bound above its upper bound, so no value satisfies it
```

Upgrading: `applied` now always means the named test passes and nothing
regressed (`ok: true`, `pass: true`, `regressed: []`). A patch that would have
landed as `applied` with `pass: false` or a non-empty `regressed` is
`test-blocked`, and the MCP `kumiki_auto_patch` tool reports it the same way.
