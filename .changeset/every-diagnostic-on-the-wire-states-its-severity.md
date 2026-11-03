---
"@kumikijs/mcp": patch
"@kumikijs/compiler": patch
"@kumikijs/cli": patch
---

Every diagnostic an MCP tool returns as JSON states its `severity`

The MCP tools serialised a diagnostic as `{code, kind, message, line, col}` and
dropped `severity`. `kumiki_check` on a file whose only diagnostic is a warning
returned a non-`isError` JSON array with nothing in it saying the entry was
advisory, and a file with a warning and an error returned two entries of the
same shape:

```json
[
  { "code": "W0212", "kind": "ui-event-tile-mismatch", "message": "…", "line": 2, "col": 17 },
  { "code": "E0103", "kind": "undef-ref", "message": "…", "line": 4, "col": 30 }
]
```

The `W` on the code was the only way to tell them apart, and that is a naming
convention, not a field. Each diagnostic now carries `severity`, always, with
`"error"` where the checker leaves the field out:

```json
[
  { "code": "W0212", …, "severity": "warning" },
  { "code": "E0103", …, "severity": "error" }
]
```

The shape is the same wherever diagnostics leave the server as JSON:
`kumiki_check` (including the `E0000` it makes of a parse failure),
`kumiki_build`'s `build failed:` list, `kumiki_fix`'s `remaining` and
`warnings` on apply, and `kumiki_auto_patch`'s `compileErrors` and
`blocked.introduced`. Those four tools' descriptions now give the shape and say
what each `severity` means. `kumiki_check` is still flagged `isError` only when
an entry has `severity` `"error"`. `kumiki_fix`'s dry-run report is text, not
JSON, and is unchanged.

`kumiki_build` on source that does not parse used to answer
`{"error": {"kind": "error", "message": "Parse error at …"}}`, unlike
`kumiki_check`. It now answers `build failed:` and an `E0000` diagnostic, the
same one `kumiki_check` reports.

`@kumikijs/compiler` exports `severityOf(d)`, which reads an omitted
`severity` as `"error"`, and the `Severity` type. `compile()`, `kumiki check`,
`kumiki fix`, the write-op rollback, the checker's own "already reported here"
tests and the MCP tools all split errors from warnings through it, so that
rule is stated in one place. It also exports `parseFailure(e)`, which turns a
lex or parse throw into that `E0000`; `kumiki fix`'s rollback report and the
MCP tools now build it there instead of each building their own.
