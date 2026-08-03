---
"@kumikijs/runtime": minor
"@kumikijs/compiler": minor
---

feat(runtime,compiler): identity-preserving reconciliation for changed-but-reused tiles (#190).

Follow-up to #187 keyed diff and #188 stable tile identity. Extends the reconcile
kernel so a same-kind tile whose data props diverge is mutated in place instead
of torn down + rebuilt — browser-owned state (`<select>` open dropdown / value,
`<video>` playback position, `<details>` open, contenteditable caret / IME
composition) now survives a reducer-triggered re-render mid-interaction.

- **Runtime** — every `tiles-*.ts` module exports a companion `{X}Patchers:
  TilePatchers` alongside `{X}Tiles`. `reconcileNode` routes same-kind
  data-prop divergences through the per-kind patcher; kinds without a patcher
  fall back to the pre-#190 subtree rebuild. A per-element `WeakMap` handler
  slot on input / textarea / select / check / radio / switch / slider /
  editable / form / button / link / modal / drawer / popover reroutes
  `bind` / `onChange` / `onClose` / `to` closure changes without add/remove-
  listener churn. The `<select>` patcher does a keyed `<option>` diff by
  serialized value key so the dropdown / selection state stays intact when
  the options list shifts. Focus / caret snapshot layer is retained as the
  fallback for wholesale-swap paths (reconcile bailout, panic recovery,
  keyed reorder that moves a focused element between DOM positions), with
  `<select>` added to its tag-name filter.

- **Compiler + runtime** — two new built-in tile kinds:
  - `details(summary=..., open=...)` — native `<details>` disclosure.
  - `editable(bind=..., text=...)` — `<div contenteditable="true">` with
    plain-text `textContent` write-back on `input`. The patcher skips text
    overwrites when the DOM already matches the target text (the common
    case during typing, where the bind loop keeps slot and DOM in sync)
    and skips them entirely while an IME composition is in flight so the
    candidate window is not dismissed mid-glyph.
  - `input`, `textarea`, and `editable` all install
    `compositionstart` / `compositionend` listeners at create time so
    JP/CN/KR IME users are not disrupted by a re-render mid-composition.

- **Spec** — `docs/spec/runtime.md` gains §10.3.11 documenting the patch
  contract, handler-slot pattern, value-write guards, and the demoted role
  of §10.3.9's snapshot layer. `docs/spec/stdlib.md` §2.3 catalog lists
  `details` and `editable`.

- **Verification** — new e2e fixtures under
  `packages/examples/features/{54,55,56,57}-*.browser.json` prove all four
  acceptance elements (`<select>` / `<video>` / `<details>` /
  `contenteditable`) survive a re-render mid-interaction under Chromium.
  `packages/runtime/test/reconcile.test.ts` adds per-kind
  identity-preserving unit coverage.

- **Benchmarks** — `packages/benchmarks/reactivity/reactivity-cost.mjs`
  now reports `nodesCreatedPerUpdate: 0` for a leaf-only text change
  across every tile-count sample (down from the #187 baseline of 1 element
  per update): the mounted `<h1>` gets `.textContent = ...` in place.

Compiler + runtime ship together — the new `details` / `editable` tiles
require the matched runtime, and the runtime's `TilePatchers` registry is
consumed by any built bundle.
