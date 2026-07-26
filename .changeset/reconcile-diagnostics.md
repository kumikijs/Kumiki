---
"@kumikijs/runtime": minor
"@kumikijs/compiler": patch
"@kumikijs/cli": minor
---

feat(runtime): dev-mode observability for the reconcile diff, and a fix for the
patcher registry that never reached built apps (#206).

**Fix, and the reason the rest of this exists.** The per-app DCE path in
codegen assembled the tile renderer registry (`_tiles`) but never the companion
patcher registry, so every `kumiki build` artifact mounted with
`tilePatchers` defaulting to `{}`. With no patcher for a kind the reconcile
rebuilds the whole subtree on any data-prop change, which discards exactly the
browser-owned state the in-place patch exists to keep: input focus and caret,
`<select>` open dropdown, `<video>` playback position, `<details>` open,
contenteditable caret. Nothing caught it because the verified corpus and the
reconcile suite all mount through the monolith entry, which merges the full
patcher set itself. The guard now drives a real build artifact and asserts
element identity survives a data change.

**`MountOptions.onDiagnostic`** opts into seeing the reconcile's
identity-losing decisions. Same shape as `episodeLogger`: absent by default, so
a production mount pays one optional call per fallback and never runs the
stale-closure scan. There is no build-time flag — a production mount is silent
because it did not opt in.

- Reported: `no-patcher`, `child-count-change` (with the old/new counts),
  `child-hole` (with the index), `child-unmapped` (with the index and the
  child's kind). Each also names the tile — kind, authored `tile` name, and
  the same `id` the episode log uses.
- Deliberately not reported: a `kind` change (a different thing occupies that
  position, so there is no identity to preserve) and a patcher declining via
  `PatchRequiresRebuild` (a normal outcome that sentinel exists to keep out of
  the log).
- `stale-closure-risk` fires on the *reuse* decision for host-registered tile
  kinds, where the prop-equality kernel's "any two functions are equal" rule
  can leave a captured handler firing forever. Built-ins route handlers through
  per-element slots and are exempt. A host sink that throws is swallowed: a
  diagnostic must never be able to change the render it observes.

**Consumers.** `SmokeReport.diagnostics` (new, non-fatal — each entry carries
the phase and trigger that provoked it) plus `SmokeOptions.diagnosticsAsIssues`
and `kumiki smoke --diagnostics-as-issues` for the strict reading.
`StepResult.diagnostics` (new) attributes churn to the scenario step that
caused it, and `kumiki run` prints it under that step. `kumiki dev` warns on
fallbacks and errors on stale closures — they are different severities.

**Spec** — `docs/spec/runtime.md` §10.3.12 with a JA mirror, and
`packages/examples/features/58-unkeyed-conditional-rebuild.kumiki` showing the
unkeyed shape that pays for a rebuild next to the keyed one that does not.
