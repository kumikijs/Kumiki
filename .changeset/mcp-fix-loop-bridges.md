---
"@kumikijs/mcp": minor
"@kumikijs/cli": minor
---

feat(mcp): add apply / auto-patch / test / episode bridges to close the AI fix loop (#155).

- mcp: `kumiki_fix` gains `apply` / `only` / `capabilities` options. With `apply: true`, patches are written to disk and the tool returns `{ applied, before, after, remaining }` (plus `parseError` when the composed patches broke syntax). Default remains dry-run so existing agents keep their safe default.
- mcp: new `kumiki_auto_patch` tool wraps `kumiki fix --auto-patch <test-name>`. Returns a structured `FixFromTestOutcome` (`status` in `{already-pass | proposed | applied | compile-proposed | compile-remaining | no-patch | not-found}`). On `apply: true` runs, the `regressed` field is always populated so regression detection is baked into the tool output.
- mcp: new `kumiki_test` tool wraps `kumiki test`, returning `{ total, passed, failed, results }` with optional `filter` (name or `prefix*`).
- mcp: new `kumiki_episode_list` / `kumiki_episode_tail` tools read `<file>.kumiki-episodes.jsonl` sidecars. `list` returns compact summaries (`id`, `trigger.kind`, `trigger.target`, `status`, `steps`), newest first; `tail` returns full episode JSON, newest first.
- mcp: `kumiki_check` gains `strictA11y` / `strictIcons` / `strictSelectorId` toggles (the same set the CLI's `--strict-*` flags surface). With `path` + `strictIcons`, `@kumikijs/icons` is resolved to widen the icon-name domain.
- mcp: `kumiki_run_scenario` description updated to name the loop-closing tools (`kumiki_auto_patch` and `kumiki_fix` with `apply: true`), so the generate → run → observe → **fix** loop is fully documented at the tool surface.
- cli: `fix.ts` and `smoke.ts` split into pure computation (`planFix` / `applyFixPlan` / `runFixFromTest` / `runTests`) and CLI printers (`fixCmd` / `fixFromTest` / `testCmd`). MCP handlers reuse the pure variants so stdio protocol is never polluted by CLI stdout. Existing CLI behavior is unchanged.
