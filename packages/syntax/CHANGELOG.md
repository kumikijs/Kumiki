# @kumikijs/syntax

## 0.3.1

### Patch Changes

- fe8e6a4: Publish the `.js` artifacts without their JSDoc

  The largest file any of these packages ships was mostly prose. `dist/index.js`
  of `@kumikijs/runtime` — the package entry, and the `./bundle` export codegen
  inlines for `bundle: true` / smoke / run / test — was 296 kB, of which 83 kB
  was JSDoc. `@kumikijs/compiler`'s was 372 kB with 95 kB of it.

  That prose has two better readers than a published bundle. Editors read it
  from the `.d.ts`, which keeps every block. People read it from the source on
  GitHub. What was left was a per-install download nobody opens.

  `tsdown.shared.ts` now carries one output setting for every package:

  ```ts
  comments: { legal: true, annotation: true, jsdoc: false }
  ```

  | artifact                  | before | after  | gzip before → after |
  | ------------------------- | ------ | ------ | ------------------- |
  | `@kumikijs/runtime` dist  | 621 kB | 538 kB | 163 kB → 128 kB     |
  | `@kumikijs/compiler` dist | 423 kB | 328 kB | 105 kB → 65 kB      |
  | `@kumikijs/cli` dist      | 196 kB | 162 kB | 45 kB → 30 kB       |
  | `@kumikijs/mcp` dist      | 33 kB  | 29 kB  | 10 kB → 9 kB        |

  This is not minification, and the two comment kinds a build cannot regenerate
  are kept:

  - `annotation` (`@__PURE__`, `@__NO_SIDE_EFFECTS__`, `@vite-ignore`). Dropping
    these would silently cost downstream bundlers the tree-shaking
    `sideEffects: false` promises — a fatter app bundle with no error anywhere.
  - `legal` (`@license`, `@preserve`, `//!`, `/*!`), which has to survive
    redistribution.

  Identifiers, formatting and the trailing `export { … }` line are untouched, so
  `@kumikijs/runtime`'s `dist/index.js` stays unminified, readable in a stack
  trace, and inline-able by `inlineRuntime` exactly as before.
  `packages/tests/dist-comments.test.ts` pins all of that: no JSDoc in any
  published `.js`, JSDoc still in the `.d.ts`, annotations still present, and an
  `inlineRuntime` round-trip over the real built bundle.

  What a compiled app downloads is unchanged — `kumiki build` ships
  `dist/modules/*`, which were already minified. An app built with
  `bundle: true` inlines 83 kB less.

## 0.3.0

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

## 0.2.0

### Minor Changes

- 0784054: Add `@kumikijs/syntax`: a TextMate grammar for the Kumiki language, providing
  real syntax highlighting for `.kumiki` files in Shiki / VitePress / VS Code.
  The docs site now highlights Kumiki code blocks with this grammar instead of
  aliasing Rust.
