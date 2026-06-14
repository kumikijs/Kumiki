# @kumikijs/vite

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
