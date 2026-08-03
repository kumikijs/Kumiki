# @kumikijs/mcp

## 0.4.0

### Minor Changes

- 46bee64: feat(cli,mcp): `kumiki fix` says why it produced no patch, instead of collapsing
  20+ distinct dead ends into one message (#177).

  `planTestPatch`'s third tier and `planFixes` between them had over twenty silent
  `return null` / `continue` branches, all of which surfaced as
  `(no auto-patch available)`. An AI iteration loop could not tell "no repair
  exists for this" from "the compiler's message format moved and the extractor
  stopped matching" — so a change to the quoted-name shape would have disabled
  every auto-patch with no signal at all.

  `planFixesExplained` / `planTestPatchExplained` return a stable kebab-case reason
  per skip. It reaches `FixFromTestOutcome`'s `no-patch` result, is printed by the
  CLI, and is exposed to the MCP bridge, with the whole chain available under
  `KUMIKI_DEBUG=fix`. Message-format drift now reads as an anomaly in the reason
  distribution rather than as silence. `planFixes` and `planTestPatch` remain as
  wrappers, so no existing caller changes.

- fb02913: feat(mcp): add apply / auto-patch / test / episode bridges to close the AI fix loop (#155).

  - mcp: `kumiki_fix` gains `apply` / `only` / `capabilities` options. With `apply: true`, patches are written to disk and the tool returns `{ applied, before, after, remaining }` (plus `parseError` when the composed patches broke syntax). Default remains dry-run so existing agents keep their safe default.
  - mcp: new `kumiki_auto_patch` tool wraps `kumiki fix --auto-patch <test-name>`. Returns a structured `FixFromTestOutcome` (`status` in `{already-pass | proposed | applied | compile-proposed | compile-remaining | no-patch | not-found}`). On `apply: true` runs, the `regressed` field is always populated so regression detection is baked into the tool output.
  - mcp: new `kumiki_test` tool wraps `kumiki test`, returning `{ total, passed, failed, results }` with optional `filter` (name or `prefix*`).
  - mcp: new `kumiki_episode_list` / `kumiki_episode_tail` tools read `<file>.kumiki-episodes.jsonl` sidecars. `list` returns compact summaries (`id`, `trigger.kind`, `trigger.target`, `status`, `steps`), newest first; `tail` returns full episode JSON, newest first.
  - mcp: `kumiki_check` gains `strictA11y` / `strictIcons` / `strictSelectorId` toggles (the same set the CLI's `--strict-*` flags surface). With `path` + `strictIcons`, `@kumikijs/icons` is resolved to widen the icon-name domain.
  - mcp: `kumiki_run_scenario` description updated to name the loop-closing tools (`kumiki_auto_patch` and `kumiki_fix` with `apply: true`), so the generate → run → observe → **fix** loop is fully documented at the tool surface.
  - cli: `fix.ts` and `smoke.ts` split into pure computation (`planFix` / `applyFixPlan` / `runFixFromTest` / `runTests`) and CLI printers (`fixCmd` / `fixFromTest` / `testCmd`). MCP handlers reuse the pure variants so stdio protocol is never polluted by CLI stdout. Existing CLI behavior is unchanged.

### Patch Changes

- 75a809b: fix(cli, mcp): escape-normalized partial-string repair + structured `writeError` surfacing.

  Robustness follow-ups from the prior review round.

  - **Escape normalization.** `planPartialStringPatchExplained` compared decoded `TestResult.leaf` values (`\n` as a real newline, `\"` as a quote, …) against raw source-literal bodies (`\n` as two chars). Any Kumiki source literal spelling an escape — `\n \t \r \" \\` — could either silently bail with `no-string-literal-contains-mida` or, worse, splice the divergent middle into the raw body and re-encode, corrupting untouched escapes (e.g. an existing `\n` doubled to `\\n`). The tier now decodes each literal body via a private `decodeKumikiStringBody` helper (lockstep with the lexer's escape set) and does its `midA` comparison, splice, and `kumikiStringLit` re-encode entirely in decoded space, so escapes round-trip canonically.
  - **I/O error surface.** The three `writeFileSync` sites in `applyFixPlan` / `runFixFromTest` used to leak EACCES / ENOSPC / EBUSY as raw stacks — asymmetric with the same file's `parseError` / `regressionBlocked` / `testRunError` structured returns. Every write now goes through a new `atomicWriteFileSync` helper (`.kumiki-tmp` staging + `renameSync`) so a mid-write ENOSPC leaves the target byte-identical instead of truncating it. `FixApplyResult` gains an optional `writeError?: string` modifier; `FixFromTestOutcome` gains a `write-failed` variant with `phase: "compile" | "test"` discriminating the two write sites (and preserving the proposed `patch` on `phase: "test"`). `fixCmd` fails loudly on stderr and sets `process.exitCode = 1` on write failure. `kumiki_fix` (MCP) surfaces `writeError` / `regressionBlocked` on the wire alongside `parseError`. `kumiki_auto_patch` documents the new status. Both consumer switches gain `default: never` exhaustiveness guards.

- Updated dependencies [35df48f]
- Updated dependencies [46bee64]
- Updated dependencies [46bee64]
- Updated dependencies [75a809b]
- Updated dependencies [46bee64]
- Updated dependencies [46bee64]
- Updated dependencies [88bd531]
- Updated dependencies [5fb6fb6]
- Updated dependencies [fb02913]
- Updated dependencies [3d89383]
- Updated dependencies [cad3f0c]
- Updated dependencies [46bee64]
- Updated dependencies [687ae40]
- Updated dependencies [46bee64]
- Updated dependencies [49cafdb]
  - @kumikijs/cli@0.7.0
  - @kumikijs/compiler@0.12.0

## 0.3.9

### Patch Changes

- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
  - @kumikijs/compiler@0.11.0
  - @kumikijs/cli@0.6.0

## 0.3.8

### Patch Changes

- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
  - @kumikijs/compiler@0.10.0
  - @kumikijs/cli@0.5.1

## 0.3.7

### Patch Changes

- Updated dependencies [c40b121]
- Updated dependencies [7e589bc]
- Updated dependencies [a27e63c]
  - @kumikijs/cli@0.5.0
  - @kumikijs/compiler@0.9.0

## 0.3.6

### Patch Changes

- Updated dependencies [3ee1a9a]
  - @kumikijs/compiler@0.8.0
  - @kumikijs/cli@0.4.1

## 0.3.5

### Patch Changes

- Updated dependencies [afe1b15]
- Updated dependencies [e92f5df]
- Updated dependencies [33fc749]
  - @kumikijs/compiler@0.7.0
  - @kumikijs/cli@0.4.0

## 0.3.4

### Patch Changes

- Updated dependencies [cd1e88a]
  - @kumikijs/compiler@0.6.0
  - @kumikijs/cli@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies [20c8601]
  - @kumikijs/compiler@0.5.0
  - @kumikijs/cli@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
  - @kumikijs/compiler@0.4.0
  - @kumikijs/cli@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [81d0791]
  - @kumikijs/compiler@0.3.1
  - @kumikijs/cli@0.3.1

## 0.3.0

### Minor Changes

- be38e20: v0.3 — the type-soundness & robustness milestone. Two soundness gaps the 0.2.1
  code review filed as issues, both closed:

  - **M1 (#24) — clean panic handling on the live path.** A panic on the live
    path (`panic(message)`, `Result.get-err` on `Ok`, or the polymorphic `.get`
    on `None`/`Err`) used to escape the DOM event handler / render uncaught. Now
    there is one model: a tagged `KumikiPanic`, caught around live reducer
    dispatch so the episode is rolled back (no partial slot writes), surfaced to
    the `smoke`/scenario tiers, and routed to the `app.error` reducer with
    `PanicInfo`; a render panic with no enclosing `error-boundary` shows a built-in
    top-level fallback. Fixes two latent bugs: `panic(message)` was unimplemented,
    and `.get` did not panic on the empty case (opposite to `.get-err`).

  - **M2 (#23) — receiver type inference for method-shortcut dispatch.** The
    parenthesis-free shortcut `recv.m` was dispatched by name only, so a record
    field named like a method (`node.head`) was silently shadowed and an unknown
    `recv.bogus` compiled to `undefined`. The checker gained its first
    type-inference pass: `FieldAccess` now dispatches field-vs-shortcut by the
    receiver's inferred type, and an unknown member on a known type is a compile
    error (**new E0108 `undef-member`**) instead of a silent wrong value.

  E0108 is a deliberate tightening (pre-1.0): a program that previously compiled
  `recv.bogus` to `undefined` now fails to compile.

### Patch Changes

- Updated dependencies [be38e20]
  - @kumikijs/compiler@0.3.0
  - @kumikijs/cli@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [c0c1708]
  - @kumikijs/compiler@0.2.1
  - @kumikijs/cli@0.2.1

## 0.2.0

### Minor Changes

- 77938ee: v0.2 — close the five spec-deferred features (M1–M5)

  - **M1 `stop-timer(name)`** — explicit named-timer stop; errors E0002 / E0106.
  - **M2 `overlay` builtin** — z-axis stacking (modals / toasts / dropdowns), `align` prop, composes with `when`.
  - **M3 plugin capability registration** — `kumiki.caps.json` manifest; unlisted caps are now a compile error (E0302).
  - **M4 `test` layer + `kumiki test` runner**, and **`kumiki fix --auto-patch <test-name>`** — in-language reducer-test / tile-test with PASS/FAIL + diff output, plus deterministic repair from a failing test.
  - **M5 `motion` layer** — reusable, closed-grammar, scoped animations referenced from a tile's `motion` prop; honors `prefers-reduced-motion`; errors E0107, E0401–E0403.

  See CHANGELOG.md for the full detail.

### Patch Changes

- Updated dependencies [77938ee]
  - @kumikijs/cli@0.2.0
  - @kumikijs/compiler@0.2.0
