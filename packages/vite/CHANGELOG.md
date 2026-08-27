# @kumikijs/vite

## 0.6.0

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

- db8e843: fix: let the Vite plugin do what a bundler plugin is for.

  **The runtime is no longer copied into every module.** `bundle` now defaults to
  `false`, so the compiled module keeps its `import "@kumikijs/runtime"` and the
  bundler ships one copy. The old default fought the pattern this plugin's own
  documentation recommends — `mount` comes from that same package — so a project
  that imported one `.kumiki` file built the runtime twice (129 kB against 82 kB
  for the counter), and each further `.kumiki` import added another. Size was the
  smaller half: the runtime keeps module-level state, and the injected
  state-style sheet is found by DOM id while its sequence counter restarts per
  copy. The plugin resolves the specifier from the project when it can and from
  its own dependency otherwise, so a project that installed only `@kumikijs/vite`
  still builds — with one copy either way. `bundle: true` remains for a module
  that must stand alone.

  **`generateDts` emitted TypeScript that did not compile.** A slot name is
  allowed to be kebab-case, and it was written into the declaration bare
  (`my-slot: string`); the generated helpers were called `Provider` / `Slots` /
  `Providers`, which are among the likelier names a program declares itself. With
  `types: true` both landed in the user's project and broke their `tsc`. Slot
  names are now quoted — the spelling the emitted `slots` object actually uses —
  the helpers are `KumikiProvider` / `KumikiSlots` / `KumikiProviders`, and a type
  whose Kumiki name is not a TypeScript identifier is declared under one that is.
  The guard runs a real `tsc` over the generated output.

  **A parse error is now a diagnostic.** `compile()` returns type errors but
  throws lex and parse errors, and the plugin only handled the returned form — so
  the most common authoring mistake reached Vite's overlay as a stack of compiler
  frames with no line to jump to. Both now arrive with file, line and column.

  **`kumiki.caps.json` is found where a project would put it.** The lookup only
  ever checked the directory holding the `.kumiki` file; a manifest at the project
  root — where the rest of a Vite project's configuration lives — was ignored
  without a word. It is now searched for from the source file up to the project
  root — the nearest `package.json` — nearest manifest wins, and a
  malformed manifest on that path is an error naming the file rather than a
  silent fall-through. `E0302` now says which manifest was read, or which
  directories were searched — in the plugin and in `kumiki check` / `kumiki
build` alike. `@kumikijs/mcp` resolves capabilities through the same helper, so
  its `path` inputs get the widened search too.

  The Vite plugin's `engines.node` moves to `>=20.6`, the release that made
  `import.meta.resolve` synchronous — the runtime fallback above is built on it.

### Patch Changes

- Updated dependencies [82cfa6c]
- Updated dependencies [85a792b]
- Updated dependencies [3b1f5e8]
- Updated dependencies [7cce9ce]
- Updated dependencies [301b09a]
- Updated dependencies [3e33233]
- Updated dependencies [f04b1c5]
- Updated dependencies [7a754ad]
- Updated dependencies [c11152b]
- Updated dependencies [080f358]
- Updated dependencies [d398cbc]
- Updated dependencies [79b221e]
- Updated dependencies [732cb16]
- Updated dependencies [b8bd5d9]
- Updated dependencies [4de2473]
- Updated dependencies [db8e843]
  - @kumikijs/compiler@0.13.0
  - @kumikijs/runtime@0.13.0

## 0.5.1

### Patch Changes

- Updated dependencies [46bee64]
- Updated dependencies [5fb6fb6]
- Updated dependencies [353cd5c]
- Updated dependencies [46bee64]
- Updated dependencies [027a8af]
- Updated dependencies [3d89383]
- Updated dependencies [cad3f0c]
- Updated dependencies [46bee64]
- Updated dependencies [4a58f8f]
- Updated dependencies [32dd683]
- Updated dependencies [687ae40]
- Updated dependencies [92ca76d]
- Updated dependencies [6f3f3e3]
- Updated dependencies [9ae4327]
- Updated dependencies [46bee64]
- Updated dependencies [49cafdb]
  - @kumikijs/compiler@0.12.0
  - @kumikijs/runtime@0.12.0

## 0.5.0

### Minor Changes

- 07e9c6b: feat(compiler,cli,vite): `--strict-icons` to flag unknown `icon(name=...)` at check time (#127).

  Kumiki ships a built-in icon set but rendering an unknown `name=` silently fell back to an empty placeholder. `--strict-icons` promotes the runtime silence into a compile-time error so typos and dropped icons are caught during `kumiki check`.

  - compiler: `check()` gains a `strictIcons` option; `E02xx strict-icon-unknown` is emitted when `name=` is not a member of the built-in set.
  - cli: `kumiki check --strict-icons` and `kumiki build --strict-icons`.
  - vite: `strictIcons: true` plugin option.
  - spec: `docs/spec/errors.md` and `docs/spec/style.md` document the strict gate.

- 07e9c6b: feat(compiler,cli,vite): `--strict-selector-id` to flag `TileName#id` typos at check time (#149).

  `E0212 selector-id-mismatch` is now emitted (opt-in via `strictSelectorId`) when a reducer subscribes to `Tile#id` but every declaration of `Tile` has a **literal** `{id: "..."}` that does not match the selector's id — the reducer would otherwise silently never fire at runtime. Tiles whose `{id}` is computed are deliberately exempt so the runtime filter remains the authority for dynamic ids.

  - compiler: `check()` gains `strictSelectorId`; `E0212` mirrors the existing `strictIcons` / `strictA11y` gate pattern.
  - cli: `kumiki check --strict-selector-id` and `kumiki build --strict-selector-id`.
  - vite: `strictSelectorId: true` plugin option.
  - spec: `docs/spec/errors.md` documents `E0212` alongside the runtime-filter fallback for dynamic ids.

### Patch Changes

- 07e9c6b: feat(compiler): `W0212 ui-event-subscription-mismatch` — warn on `ui-event` subscriptions that cannot fire (#143).

  When a reducer subscribes to a `ui-event` on a tile that cannot emit it (e.g. `ui.submit(DivTile)` or `ui.focus(NonFocusableTile)`), the compiler now emits `W0212` instead of silently generating a handler the DOM will never invoke. The rule consults the ui-event implicit-lift table (single source of truth in `packages/compiler/src/ui-lifts.ts`) to decide whether the subscription is admissible.

  - compiler: `checkReducer` cross-references the target tile's kind against the ui-event's admissible tile set.
  - runtime / cli / vite: no behavioural change; the diagnostic surfaces through the standard `check` gate and Vite overlay.
  - spec: `docs/spec/errors.md` and `docs/spec/stdlib.md` document `W0212`; `docs/spec/language.md` cross-links to the ui-event lift table.

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
- Updated dependencies [07e9c6b]
  - @kumikijs/runtime@0.11.0
  - @kumikijs/compiler@0.11.0

## 0.4.6

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

## 0.4.5

### Patch Changes

- Updated dependencies [c40b121]
- Updated dependencies [7e589bc]
- Updated dependencies [c4833bd]
  - @kumikijs/runtime@0.9.0
  - @kumikijs/compiler@0.9.0

## 0.4.4

### Patch Changes

- Updated dependencies [3ee1a9a]
  - @kumikijs/compiler@0.8.0
  - @kumikijs/runtime@0.8.0

## 0.4.3

### Patch Changes

- Updated dependencies [afe1b15]
- Updated dependencies [e92f5df]
- Updated dependencies [33fc749]
  - @kumikijs/compiler@0.7.0
  - @kumikijs/runtime@0.7.0

## 0.4.2

### Patch Changes

- Updated dependencies [cd1e88a]
  - @kumikijs/compiler@0.6.0
  - @kumikijs/runtime@0.6.0

## 0.4.1

### Patch Changes

- Updated dependencies [20c8601]
- Updated dependencies [20c8601]
  - @kumikijs/runtime@0.5.0
  - @kumikijs/compiler@0.5.0

## 0.4.0

### Minor Changes

- c51b7b8: feat: `@kumikijs/vite` build integration + typed provider helpers (build seam)

  New package **`@kumikijs/vite`** — a Vite plugin so any Vite/Next/Astro project can
  `import App from "./app.kumiki"`. Each source compiles to an ESM module that
  default-exports the compiled `AppShape` (the importer mounts it via `mount` /
  `defineKumikiElement`). Sibling `kumiki.caps.json` is resolved automatically.
  Options: `bundle` (inline the runtime, default true) and `types` (emit a sibling
  `<name>.kumiki.gen.ts` of typed `Slots`/`Providers` helpers). Ambient import
  typing via `@kumikijs/vite/client`.

  Compiler additions backing it:

  - `codegen` / `compile` gain `exportApp` — emit `export default App;` instead of
    auto-mounting to `#root` (module mode for importers).
  - New `generateDts(program)` API — maps the `type`/`slot`/`effect` layers to a
    TypeScript declaration (typed `Slots` and per-custom-capability `Providers`),
    so host provider adapters get real input/output types. Conservative mapping
    (`unknown` fallback for shapes whose runtime representation isn't promised).

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
