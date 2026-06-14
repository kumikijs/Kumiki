# @kumikijs/cli

## 0.5.1

### Patch Changes

- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
- Updated dependencies [47bc7aa]
  - @kumikijs/compiler@0.10.0
  - @kumikijs/runtime@0.10.0

## 0.5.0

### Minor Changes

- 7e589bc: Per-app dead-code elimination for `kumiki build` (#71). The runtime is now
  composed of granular feature modules — `core` (mount/dispatch/theme/render
  seam), `stdlib`, `testkit` (the reducer/property/tile test harness),
  `router`, `effects-{storage,http,toast}`, and seven `tiles-*` renderer
  families — published as `@kumikijs/runtime/modules/*` (minified ESM).
  Codegen tracks which built-in tiles, effects, and routing features an app
  uses and, in the new `runtimeModulesDir` mode, imports only those modules,
  mounting through the new `mountCore` (the classic `mount`, merged
  `_stdlib`, `builtinEffects`, and the `./bundle` / `./bundle.min` artifacts
  are unchanged). `kumiki build` ships `runtime/` with exactly that pruned
  set instead of a monolithic `runtime.js`: the counter example drops from
  50KB/15.2KB gzip to ~27KB/~9KB gzip and carries no router, table/overlay
  tile, effect-handler, or test-harness code. The router ships only when the
  app can actually navigate (nav caps, `navigate*` emits, `link` /
  `route-outlet`, redirects, or routes beyond the `"/"` + `"/404"`
  boilerplate) — a static single-route app never reads the URL, so a deep
  link to an unknown path renders the root tile rather than the 404 tile.

### Patch Changes

- c40b121: Ship a minified runtime to built apps. `@kumikijs/runtime` now emits two
  artifacts: `./bundle` (unminified — still what codegen inlines for
  smoke/run/test and the playground, where readable traces matter and the
  inliner relies on stable top-level names) and the new `./bundle.min`
  (minified ESM). `kumiki build` writes `bundle.min` as the app's
  `runtime.js`, cutting it from 90KB/24.8KB gzip to 50KB/15.2KB gzip. The
  package also declares `sideEffects: false`, so bundlers consuming
  `@kumikijs/runtime` through `@kumikijs/vite` can tree-shake unused exports.
  A new CLI test mounts the exact built artifact pair in a headless DOM to
  guarantee runtime parity.
- a27e63c: Replace jsdom with happy-dom as the headless DOM behind `kumiki smoke` / `run` /
  `test`. jsdom pulled ~40 transitive packages into every CLI install; happy-dom's
  `GlobalRegistrator` provides the same DOM globals with a handful of dependencies
  and also replaces the hand-rolled realm patching (Node's own `Event` /
  `navigator` globals vs the DOM realm) that jsdom required. Verification behavior
  is unchanged — the whole example corpus passes check + build + smoke + scenario
  runs on the new environment.
- Updated dependencies [c40b121]
- Updated dependencies [7e589bc]
- Updated dependencies [c4833bd]
  - @kumikijs/runtime@0.9.0
  - @kumikijs/compiler@0.9.0

## 0.4.1

### Patch Changes

- Updated dependencies [3ee1a9a]
  - @kumikijs/compiler@0.8.0
  - @kumikijs/runtime@0.8.0

## 0.4.0

### Minor Changes

- 33fc749: v0.6 M4 (#52) — `kumiki test` runner polish (`spec/testing.md` §8.7). Per-test timings on every line (`(1ms)`; property-tests add `(100 cases, 23ms)`); `--coverage` reports per reducer/effect/tile what the suite exercises and lists the uncovered (computed statically by codegen into `globalThis.__kumikiCoverage`); `--watch` re-runs the filtered suite on `.kumiki` change (debounced, clean Ctrl-C exit). Completes the v0.6 testing-DSL milestone.

### Patch Changes

- Updated dependencies [afe1b15]
- Updated dependencies [e92f5df]
- Updated dependencies [33fc749]
  - @kumikijs/compiler@0.7.0
  - @kumikijs/runtime@0.7.0

## 0.3.4

### Patch Changes

- Updated dependencies [cd1e88a]
  - @kumikijs/compiler@0.6.0
  - @kumikijs/runtime@0.6.0

## 0.3.3

### Patch Changes

- Updated dependencies [20c8601]
- Updated dependencies [20c8601]
  - @kumikijs/runtime@0.5.0
  - @kumikijs/compiler@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
- Updated dependencies [c51b7b8]
  - @kumikijs/runtime@0.4.0
  - @kumikijs/compiler@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [81d0791]
  - @kumikijs/compiler@0.3.1

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
  - @kumikijs/runtime@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [c0c1708]
  - @kumikijs/compiler@0.2.1
  - @kumikijs/runtime@0.2.1

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
  - @kumikijs/compiler@0.2.0
  - @kumikijs/runtime@0.2.0
