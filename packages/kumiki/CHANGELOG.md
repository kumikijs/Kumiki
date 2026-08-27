# kumiki

## 0.4.0

### Minor Changes

- 301b09a: chore: require Node 24.

  Node 20 reached end of life, so every package's `engines.node` moves from
  `>=20` (`>=20.6` for `@kumikijs/vite`, which needs the synchronous
  `import.meta.resolve` that landed there) to `>=24`. CI builds and tests on 24
  as well, matching the release workflow, which was already there.

  **Breaking for anyone installing on Node 20 or 22**: the packages declare the
  new floor, so `npm i` warns and an `engine-strict` install fails. Nothing in
  the published code depends on a Node 24 API today — the bump states the
  version the toolchain is actually tested on, rather than one that no longer
  receives security fixes.

### Patch Changes

- Updated dependencies [bf37539]
- Updated dependencies [f48fd58]
- Updated dependencies [301b09a]
- Updated dependencies [7a754ad]
- Updated dependencies [d398cbc]
- Updated dependencies [732cb16]
- Updated dependencies [4de2473]
- Updated dependencies [db8e843]
  - @kumikijs/cli@0.8.0

## 0.3.10

### Patch Changes

- Updated dependencies [35df48f]
- Updated dependencies [46bee64]
- Updated dependencies [46bee64]
- Updated dependencies [75a809b]
- Updated dependencies [46bee64]
- Updated dependencies [46bee64]
- Updated dependencies [88bd531]
- Updated dependencies [fb02913]
- Updated dependencies [cad3f0c]
- Updated dependencies [46bee64]
- Updated dependencies [687ae40]
  - @kumikijs/cli@0.7.0

## 0.3.9

### Patch Changes

- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
- Updated dependencies [07e9c6b]
  - @kumikijs/cli@0.6.0

## 0.3.8

### Patch Changes

- @kumikijs/cli@0.5.1

## 0.3.7

### Patch Changes

- Updated dependencies [c40b121]
- Updated dependencies [7e589bc]
- Updated dependencies [a27e63c]
  - @kumikijs/cli@0.5.0

## 0.3.6

### Patch Changes

- @kumikijs/cli@0.4.1

## 0.3.5

### Patch Changes

- Updated dependencies [33fc749]
  - @kumikijs/cli@0.4.0

## 0.3.4

### Patch Changes

- @kumikijs/cli@0.3.4

## 0.3.3

### Patch Changes

- @kumikijs/cli@0.3.3

## 0.3.2

### Patch Changes

- @kumikijs/cli@0.3.2

## 0.3.1

### Patch Changes

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
  - @kumikijs/cli@0.3.0

## 0.2.1

### Patch Changes

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
