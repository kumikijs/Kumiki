---
"@kumikijs/mcp": patch
---

`kumiki_build` and `kumiki_auto_patch` report the warnings the compile found

`compile()` returns its warnings on success and on failure, and two MCP tools
dropped them. On a file whose only diagnostic is a warning, `kumiki_check`
listed it while `kumiki_build` answered with one item and nothing about it:

```text
build ok — 260108 bytes of JS (pass includeJs=true for the source)
```

and `kumiki_auto_patch` answered:

```json
{ "ok": true, "status": "already-pass", "pass": true }
```

A failed build listed only the errors that failed it, so a file with a warning
and an error got two diagnostics from `kumiki_check` and one from
`kumiki_build`.

`kumiki_build` now hands a successful build's warnings back in a second text
content item, as the same JSON diagnostic list `kumiki_check` returns, and the
result is still not `isError`. The first item is unchanged: the size summary,
or with `includeJs` the generated JS and nothing else. A build with no
warnings still answers in one item.

```text
build ok — 260108 bytes of JS (pass includeJs=true for the source)
```
```json
[{ "code": "W0212", "kind": "ui-event-tile-mismatch", …, "severity": "warning" }]
```

A failed build lists every diagnostic after `build failed:`, the warnings
first and then the errors, the order `kumiki build` prints them in, each with
its `severity`.

`kumiki_auto_patch` puts `warnings` on every outcome, beside `compileErrors`
and `blocked.introduced`, which hold errors only. It is the list `kumiki fix
--auto-patch` already printed under its verdict:

```json
{ "ok": true, "status": "already-pass", "warnings": [{ "code": "W0212", …, "severity": "warning" }], "pass": true }
```

Both tools' descriptions say where the warnings appear.
